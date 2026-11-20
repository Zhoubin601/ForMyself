import hashlib
import hmac
import json
import struct
from pathlib import Path
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

PASSWORD = " 合成📦 e\u0301 \u0000\ufeff "
SALT = bytes(range(0, 16))
BACKUP_ID = bytes(range(16, 32))
WRAP_NONCE = bytes(range(32, 44))
BEK = bytes(range(64, 96))

SCHEMA_FINGERPRINT = bytes.fromhex(
    "8d4ede29039ca2958146250e618ee78e76163490e47eeaaab74b02dde852f39a"
)

RUNTIME_TABLES = {"data_migrations", "schema_migration_applications", "schema_migrations"}
DERIVED_TABLES = {
    "baseline_array_order",
    "effect_array_order",
    "entity_ids",
    "event_array_order",
    "participants",
}
ORDERED_TABLES = {"effect_baselines", "world_effects", "world_events"}

ALL_TABLE_NAMES = [
    "archived_message_marks",
    "autonomy_policies",
    "background_tasks",
    "baseline_array_order",
    "card_versions",
    "character_cards",
    "character_instances",
    "conversation_participants",
    "conversations",
    "data_migrations",
    "dataset_metadata",
    "domain_command_receipts",
    "effect_array_order",
    "effect_baselines",
    "entity_ids",
    "event_array_order",
    "event_audits",
    "event_causes",
    "event_life_sources",
    "event_participants",
    "event_sources",
    "life_grants",
    "lorebook_entries",
    "lorebook_known_by",
    "memories",
    "memory_events",
    "memory_known_by",
    "memory_life_sources",
    "memory_links",
    "memory_policies",
    "memory_sources",
    "message_audits",
    "message_life_sources",
    "messages",
    "participants",
    "preset_applications",
    "relationship_events",
    "relationships",
    "role_binding_state",
    "role_bindings",
    "schema_migration_applications",
    "schema_migrations",
    "task_result_events",
    "task_result_memories",
    "task_social_participants",
    "task_sources",
    "usage_events",
    "virtual_schedule_days",
    "virtual_schedules",
    "world_effects",
    "world_events",
    "world_identities",
    "worlds",
]


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    okm = bytearray()
    t = b""
    counter = 1
    while len(okm) < length:
        t = hmac.new(prk, t + info + bytes([counter]), hashlib.sha256).digest()
        okm.extend(t)
        counter += 1
    return bytes(okm[:length])


def encode_col_text(val: str | None) -> bytes:
    if val is None:
        return b"\x00"
    raw = val.encode("utf-8", errors="strict")
    return b"\x01" + struct.pack(">I", len(raw)) + raw


def encode_col_i64(val: int | None) -> bytes:
    if val is None:
        return b"\x00"
    return b"\x01" + struct.pack(">q", val)


def encode_col_f64(val: float | None) -> bytes:
    if val is None:
        return b"\x00"
    if val == 0.0:
        val = 0.0
    return b"\x01" + struct.pack(">d", val)


def table_digest(table_id: int, framed_rows: list[bytes]) -> bytes:
    h = hashlib.sha256()
    h.update(b"KPB1/table\x00" + struct.pack(">H", table_id))
    for r in framed_rows:
        h.update(r)
    return h.digest()


def frame_row(body: bytes) -> bytes:
    return struct.pack(">I", len(body)) + body


def build_package(business_framed_rows: dict[int, list[bytes]], derived_framed_rows: dict[int, list[bytes]]):
    header = (
        b"KANATA1\x00"
        + struct.pack(">HHHHI", 1, 1, 0xFF01, 0, 600000)
        + SALT
        + BACKUP_ID
        + struct.pack(">BBI", 1, 1, 65536)
        + b"\x00" * 6
    )
    assert len(header) == 64

    pw_bytes = PASSWORD.encode("utf-8", errors="strict")
    base_kek = hashlib.pbkdf2_hmac(
        "sha256", pw_bytes, b"KPB1/KEK\x00" + SALT + BACKUP_ID, 600000, 32
    )
    wrap_key = hkdf_sha256(base_kek, BACKUP_ID, b"KPB1/wrap\x00" + header, 32)
    wrapped_bek = AESGCM(wrap_key).encrypt(WRAP_NONCE, BEK, header)
    prefix = header + WRAP_NONCE + wrapped_bek
    assert len(prefix) == 124
    envelope_digest = hashlib.sha256(prefix).digest()

    def frame_key(stream_id: int, ftype: int) -> bytes:
        return hkdf_sha256(
            BEK, BACKUP_ID, b"KPB1/frame\x00" + struct.pack(">HB", stream_id, ftype), 32
        )

    def frame_nonce(stream_id: int, ftype: int, index: int) -> bytes:
        return struct.pack(">HBBQ", stream_id, ftype, 0, index)

    transcript = hashlib.sha256()
    transcript.update(b"KPB1/transcript\x00" + envelope_digest)

    # MANIFEST
    manifest_plain = (
        struct.pack(">IH", 0x4B4E5441, 5) + SCHEMA_FINGERPRINT + struct.pack(">BB", 1, 0)
    )
    assert len(manifest_plain) == 40
    mf_header = struct.pack(">HBBQII", 0, 1, 0, 0, 40, 56)
    mf_cipher = AESGCM(frame_key(0, 1)).encrypt(
        frame_nonce(0, 1, 0), manifest_plain, envelope_digest + mf_header
    )
    transcript.update(mf_header + mf_cipher)

    # Build logical DATA stream & verifiers
    logical = bytearray()
    verifiers = []
    for idx, name in enumerate(ALL_TABLE_NAMES):
        tid = idx + 1
        if name in RUNTIME_TABLES:
            continue
        if name in DERIVED_TABLES:
            rows = derived_framed_rows.get(tid, [])
            verifiers.append((tid, len(rows), table_digest(tid, rows)))
        else:
            rows = business_framed_rows.get(tid, [])
            logical.extend(struct.pack(">HQ", tid, len(rows)))
            for r in rows:
                logical.extend(r)
            verifiers.append((tid, len(rows), table_digest(tid, rows)))

    # Chunk logical into 65536-byte DATA frames
    data_chunks = [bytes(logical[i : i + 65536]) for i in range(0, len(logical), 65536)]
    assert len(data_chunks) >= 1
    data_frames = bytearray()
    total_plain = 0
    total_cipher = 0
    data_key = frame_key(1, 2)
    for fidx, chunk in enumerate(data_chunks):
        flags = 1 if fidx == len(data_chunks) - 1 else 0
        plen = len(chunk)
        clen = plen + 16
        fh = struct.pack(">HBBQII", 1, 2, flags, fidx, plen, clen)
        fc = AESGCM(data_key).encrypt(frame_nonce(1, 2, fidx), chunk, envelope_digest + fh)
        transcript.update(fh + fc)
        data_frames.extend(fh + fc)
        total_plain += plen
        total_cipher += clen

    transcript_digest = transcript.digest()

    # FOOTER
    footer_plain = bytearray(struct.pack(">IQQ", len(data_chunks), total_plain, total_cipher))
    footer_plain.extend(transcript_digest)
    for tid, count, dig in verifiers:
        footer_plain.extend(struct.pack(">HQ", tid, count) + dig)
    assert len(footer_plain) == 2152

    ff_header = struct.pack(">HBBQII", 0, 3, 0, 0, 2152, 2168)
    ff_cipher = AESGCM(frame_key(0, 3)).encrypt(
        frame_nonce(0, 3, 0), bytes(footer_plain), envelope_digest + ff_header
    )

    package = prefix + mf_header + mf_cipher + bytes(data_frames) + ff_header + ff_cipher
    return {
        "packageHex": package.hex(),
        "packageSha256": hashlib.sha256(package).hexdigest(),
        "packageByteLength": len(package),
        "prefixHex": prefix.hex(),
        "envelopeDigestHex": envelope_digest.hex(),
        "baseKekHex": base_kek.hex(),
        "wrapKeyHex": wrap_key.hex(),
        "manifestKeyHex": frame_key(0, 1).hex(),
        "dataKeyHex": data_key.hex(),
        "footerKeyHex": frame_key(0, 3).hex(),
        "manifestFrameHex": (mf_header + mf_cipher).hex(),
        "footerFrameHex": (ff_header + ff_cipher).hex(),
        "transcriptHex": transcript_digest.hex(),
        "dataFrameCount": len(data_chunks),
        "totalPlaintextBytes": total_plain,
        "totalCiphertextBytes": total_cipher,
        "verifiers": [
            {"tableId": tid, "rowCount": count, "digestHex": dig.hex()}
            for tid, count, dig in verifiers
        ],
    }


def main():
    empty_vec = build_package({}, {})

    # Vector B: populated deterministic synthetic row across core tables + ordered table + negative zero + i64 extremes
    tid_by_name = {name: i + 1 for i, name in enumerate(ALL_TABLE_NAMES)}

    # 11 dataset_metadata: singleton=1, user_id='user-kat', data_version=2, extensions_json='{"k": 1}'
    row_dataset = frame_row(
        encode_col_i64(1)
        + encode_col_text("user-kat")
        + encode_col_i64(2)
        + encode_col_text('{"k":  1}')
    )
    # 53 worlds: id='w1', name='合成世界📦', rules='r', revision=1, time_zone='UTC', created_at=-9223372036854775808 (i64 min),
    # last_simulated_at=9223372036854775807 (i64 max), autonomy_enabled=1, proactive_enabled=0, notifications_enabled=1,
    # default_chat_mode='daily', archived=None, identity_id='id-1', extensions_json='{}'
    row_world = frame_row(
        encode_col_text("w1")
        + encode_col_text("合成世界📦")
        + encode_col_text("r")
        + encode_col_i64(1)
        + encode_col_text("UTC")
        + encode_col_i64(-(1 << 63))
        + encode_col_i64((1 << 63) - 1)
        + encode_col_i64(1)
        + encode_col_i64(0)
        + encode_col_i64(1)
        + encode_col_text("daily")
        + encode_col_i64(None)
        + encode_col_text("id-1")
        + encode_col_text("{}")
    )
    # 52 world_identities: id='id-1', world_id='w1', user_id='user-kat', display_name=' e\u0301 \x00\ufeff ', background='bg', revision=1, extensions_json='{}'
    row_identity = frame_row(
        encode_col_text("id-1")
        + encode_col_text("w1")
        + encode_col_text("user-kat")
        + encode_col_text(" e\u0301 \x00\ufeff ")
        + encode_col_text("bg")
        + encode_col_i64(1)
        + encode_col_text("{}")
    )
    # 7 character_instances (test REAL -0.0 -> +0.0 normalization!)
    row_instance = frame_row(
        encode_col_text("inst-1")
        + encode_col_text("w1")
        + encode_col_text("card-1")
        + encode_col_text("ver-1")
        + encode_col_i64(1)
        + encode_col_text("{}")
        + encode_col_text("calm")
        + encode_col_f64(-0.0)
        + encode_col_text("home")
        + encode_col_i64(1)
        + encode_col_i64(0)
        + encode_col_text("{}")
    )
    # 51 world_events (has u64 ordinal=0 at start of body!)
    row_event = frame_row(
        struct.pack(">Q", 0)
        + encode_col_text("evt-1")
        + encode_col_text("w1")
        + encode_col_text("committed")
        + encode_col_text("private")
        + encode_col_text("约定")
        + encode_col_i64(1000)
        + encode_col_i64(1000)
        + encode_col_i64(1)
        + encode_col_text(None)
        + encode_col_text("note")
        + encode_col_text(None)
        + encode_col_text(None)
        + encode_col_text(None)
        + encode_col_text(None)
        + encode_col_text("{}")
    )
    # 3 background_tasks (post pause-sending-v1: state='cancelled', lease_until=0)
    row_task = frame_row(
        encode_col_text("task-1")
        + encode_col_text("w1")
        + encode_col_text("proactive")
        + encode_col_text("cancelled")
        + encode_col_text("k1")
        + encode_col_i64(1)
        + encode_col_i64(1)
        + encode_col_i64(2000)
        + encode_col_i64(0)
        + encode_col_text(None)
        + encode_col_text(None)
        + encode_col_text(None)
        + encode_col_text("{}")
        + encode_col_text(None)
        + encode_col_text(None)
        + encode_col_i64(None)
        + encode_col_i64(None)
        + encode_col_i64(None)
        + encode_col_text("{}")
    )

    # Derived rows for Vector B: entity_ids (15), event_array_order (16), participants (35)
    derived_entity_ids = [
        frame_row(encode_col_text("evt-1") + encode_col_text("world_events")),
        frame_row(encode_col_text("id-1") + encode_col_text("world_identities")),
        frame_row(encode_col_text("inst-1") + encode_col_text("character_instances")),
        frame_row(encode_col_text("task-1") + encode_col_text("background_tasks")),
        frame_row(encode_col_text("w1") + encode_col_text("worlds")),
    ]
    derived_event_order = [
        frame_row(encode_col_text("w1") + encode_col_text("evt-1") + encode_col_i64(0)),
    ]
    derived_participants = [
        frame_row(
            encode_col_text("w1")
            + encode_col_text("id-1")
            + encode_col_text("user")
            + encode_col_text("id-1")
            + encode_col_text(None)
        ),
        frame_row(
            encode_col_text("w1")
            + encode_col_text("inst-1")
            + encode_col_text("character")
            + encode_col_text(None)
            + encode_col_text("inst-1")
        ),
    ]

    populated_vec = build_package(
        {
            tid_by_name["background_tasks"]: [row_task],
            tid_by_name["character_instances"]: [row_instance],
            tid_by_name["dataset_metadata"]: [row_dataset],
            tid_by_name["world_events"]: [row_event],
            tid_by_name["world_identities"]: [row_identity],
            tid_by_name["worlds"]: [row_world],
        },
        {
            tid_by_name["entity_ids"]: derived_entity_ids,
            tid_by_name["event_array_order"]: derived_event_order,
            tid_by_name["participants"]: derived_participants,
        },
    )

    out_path = Path(__file__).with_name("vectors-v1.json")
    out_path.write_text(
        json.dumps(
            {
                "version": 1,
                "generator": "Python 3.13.5 hashlib/hmac/struct + cryptography 50.0.1 AESGCM",
                "password": PASSWORD,
                "material": {
                    "saltHex": SALT.hex(),
                    "backupIdHex": BACKUP_ID.hex(),
                    "wrapNonceHex": WRAP_NONCE.hex(),
                    "bekHex": BEK.hex(),
                },
                "emptyPackage": empty_vec,
                "populatedPackage": populated_vec,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    print("Wrote", out_path)
    print("emptyPackage sha256:", empty_vec["packageSha256"], "len:", empty_vec["packageByteLength"])
    print("populatedPackage sha256:", populated_vec["packageSha256"], "len:", populated_vec["packageByteLength"])


if __name__ == "__main__":
    main()
