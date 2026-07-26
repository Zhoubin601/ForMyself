import assert from 'node:assert/strict'
import test from 'node:test'
import { getSquareImageCrop } from '../src/services/chatAvatar.js'

test('头像裁剪会从横图中央截取正方形', () => {
  assert.deepEqual(getSquareImageCrop(800, 600), {
    sx: 100,
    sy: 0,
    size: 600
  })
})

test('头像裁剪会从竖图中央截取正方形', () => {
  assert.deepEqual(getSquareImageCrop(600, 900), {
    sx: 0,
    sy: 150,
    size: 600
  })
})
