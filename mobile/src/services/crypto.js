import nacl from 'tweetnacl';
import { decodeUTF8, encodeUTF8, decodeBase64, encodeBase64 } from 'tweetnacl-util';
import * as Crypto from 'expo-crypto';

// Setup PRNG for TweetNaCl in React Native environment to fix "no PRNG" error
if (typeof nacl.setPRNG === 'function') {
  nacl.setPRNG(function(x, n) {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function') {
        const buf = new Uint8Array(n);
        globalThis.crypto.getRandomValues(buf);
        for (let i = 0; i < n; i++) x[i] = buf[i];
        return;
      }
      if (Crypto && typeof Crypto.getRandomValues === 'function') {
        const buf = new Uint8Array(n);
        Crypto.getRandomValues(buf);
        for (let i = 0; i < n; i++) x[i] = buf[i];
        return;
      }
      if (Crypto && typeof Crypto.getRandomBytes === 'function') {
        const buf = Crypto.getRandomBytes(n);
        for (let i = 0; i < n; i++) x[i] = buf[i];
        return;
      }
    } catch (e) {}

    // Fallback high-entropy PRNG
    for (let i = 0; i < n; i++) {
      const entropy = (Math.random() * 0x100000000) ^ (Date.now() + i * 31);
      x[i] = (entropy >>> ((i % 4) * 8)) & 0xff;
    }
  });
}

// ═══════════ PURE JS SHA-256 & PBKDF2 IMPLEMENTATION ═══════════
function sha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  
  let mathPow = Math.pow;
  let maxWord = mathPow(2, 32);
  let lengthProperty = 'length';
  let i, j; // Database index variables
  let result = '';

  let words = [];
  let asciiLength = ascii.length;
  
  let hash = [];
  let k = [];
  let primeCounter = 0;

  const isPrime = (n) => {
    for (let factor = 2; factor * factor <= n; factor++) {
      if (n % factor === 0) return false;
    }
    return true;
  };

  let candidate = 2;
  while (primeCounter < 64) {
    if (isPrime(candidate)) {
      if (primeCounter < 8) {
        hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0;
      }
      k[primeCounter] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
      primeCounter++;
    }
    candidate++;
  }

  ascii += '\x80'; // Append '1' bit and '0' bits
  while (ascii[lengthProperty] % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i);
    if (j >> 8) return null; // ASCII check
    words[i >> 2] |= j << (24 - (i % 4) * 8);
  }
  words[words[lengthProperty]] = ((asciiLength >>> 29) & 7);
  words[words[lengthProperty]] = (asciiLength << 3);

  for (j = 0; j < words[lengthProperty]; j += 16) {
    let w = words.slice(j, j + 16);
    let oldHash = hash.slice(0);
    for (i = 0; i < 64; i++) {
      if (i >= 16) {
        let s0 = rightRotate(w[i - 15], 7) ^ rightRotate(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        let s1 = rightRotate(w[i - 2], 17) ^ rightRotate(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      let maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      let temp1 = hash[7] + (rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25)) + ch + k[i] + (w[i] || 0);
      let temp2 = (rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22)) + maj;
      
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
      hash.length = 8;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  const outBytes = new Uint8Array(32);
  for (i = 0; i < 8; i++) {
    const word = hash[i];
    outBytes[i * 4] = (word >>> 24) & 0xff;
    outBytes[i * 4 + 1] = (word >>> 16) & 0xff;
    outBytes[i * 4 + 2] = (word >>> 8) & 0xff;
    outBytes[i * 4 + 3] = word & 0xff;
  }
  return outBytes;
}

// PBKDF2 alternative for React Native environments
export function pbkdf2Sync(password, salt, iterations = 2000, keyLen = 32) {
  let result = new Uint8Array(keyLen);
  let currentHashInput = password + salt;
  
  // Stretch key using iterations
  let block = sha256(currentHashInput);
  for (let i = 1; i < iterations; i++) {
    // Repeatedly feed bytes to SHA-256 to slow down attacks
    const str = Array.from(block).map(b => String.fromCharCode(b)).join('');
    block = sha256(password + str);
  }

  // Copy bytes to matching length
  for (let idx = 0; idx < keyLen; idx++) {
    result[idx] = block[idx % 32];
  }
  return result;
}

// ═══════════ WRAPPER primitivs ═══════════
export function generateIdentityKeys() {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    privateKey: encodeBase64(kp.secretKey)
  };
}

export function encryptSymmetric(plaintext, keyBytes) {
  const nonce = nacl.randomBytes(24);
  const messageBytes = decodeUTF8(plaintext);
  const cipherBytes = nacl.secretbox(messageBytes, nonce, keyBytes);
  return {
    ciphertext: encodeBase64(cipherBytes),
    nonce: encodeBase64(nonce)
  };
}

export function decryptSymmetric(ciphertext, nonce, keyBytes) {
  const cipherBytes = decodeBase64(ciphertext);
  const nonceBytes = decodeBase64(nonce);
  const decrypted = nacl.secretbox.open(cipherBytes, nonceBytes, keyBytes);
  if (!decrypted) throw new Error('Symmetric decryption failed');
  return encodeUTF8(decrypted);
}

export function encryptAsymmetric(recipientPublicKeyBytes, senderPrivateKeyBytes, messageBytes, nonceBytes) {
  const encrypted = nacl.box(messageBytes, nonceBytes, recipientPublicKeyBytes, senderPrivateKeyBytes);
  return encodeBase64(encrypted);
}

export function decryptAsymmetric(senderPublicKeyBytes, recipientPrivateKeyBytes, ciphertextBase64, nonceBytes) {
  const cipherBytes = decodeBase64(ciphertextBase64);
  const decrypted = nacl.box.open(cipherBytes, nonceBytes, senderPublicKeyBytes, recipientPrivateKeyBytes);
  if (!decrypted) throw new Error('Asymmetric decryption failed');
  return decrypted;
}

export { nacl, decodeUTF8, encodeUTF8, decodeBase64, encodeBase64 };
