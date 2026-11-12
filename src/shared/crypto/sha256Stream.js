import CryptoJS from 'crypto-js'
import { utf8Words } from './utf8Words.js'

/** Incremental UTF-8 hash; release erases retained partial blocks and closes it.
 * @returns {{update(text:string):void,finish():string,release():void}} */
export function createSha256Stream(){
  const digest=CryptoJS.algo.SHA256.create()
  let released=false
  const release=()=>{
    digest._data?.words?.fill(0)
    digest._hash?.words?.fill(0)
    digest.reset()
    released=true
  }
  return {
    update(text){
      if(released)throw new Error('SHA256_STREAM_RELEASED')
      digest.update(utf8Words(text))
    },
    finish(){
      if(released)throw new Error('SHA256_STREAM_RELEASED')
      try{return digest.finalize().toString()}finally{release()}
    },
    release,
  }
}
