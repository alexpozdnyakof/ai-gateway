// Офлайн-генерация HD-кошелька для депозитов.
// Печатает mnemonic (СОХРАНИ ОФФЛАЙН — НЕ в .env) и account xpub (m/44'/195'/0')
// для TRON_XPUB. Опционально показывает первые депозит-адреса для сверки.
//
//   node scripts/gen-wallet.mjs            # сгенерировать новый кошелёк
//   MNEMONIC="word word ..." node scripts/gen-wallet.mjs   # из своей мнемоники
//
// Запускать ЛОКАЛЬНО, желательно офлайн. Приватный ключ/mnemonic на сервер не попадают.

import * as bip39 from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58check } from "@scure/base";

const b58c = base58check(sha256);
function tronAddress(compressed) {
  const xy = secp256k1.Point.fromBytes(compressed).toBytes(false).slice(1);
  const body = keccak_256(xy).slice(-20);
  const addr = new Uint8Array(21);
  addr[0] = 0x41;
  addr.set(body, 1);
  return b58c.encode(addr);
}

const mnemonic = process.env.MNEMONIC?.trim() || bip39.generateMnemonic(wordlist, 128);
const seed = bip39.mnemonicToSeedSync(mnemonic);
const account = HDKey.fromMasterSeed(seed).derive("m/44'/195'/0'");
const xpub = account.publicExtendedKey;

console.log("\n=== MNEMONIC — СОХРАНИ ОФФЛАЙН, НЕ В .env ===");
console.log(mnemonic);
console.log("\n=== TRON_XPUB (в .env) ===");
console.log(xpub);
console.log("\n=== Первые депозит-адреса (для сверки, m/44'/195'/0'/0/i) ===");
const ext = HDKey.fromExtendedKey(xpub).deriveChild(0);
for (let i = 0; i < 3; i++) {
  console.log(`  [${i}] ${tronAddress(ext.deriveChild(i).publicKey)}`);
}
console.log();
