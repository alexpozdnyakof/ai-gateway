import { HDKey } from "@scure/bip32";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58check } from "@scure/base";
import { config } from "../config.js";

// Tron-адрес = 0x41 || keccak256(uncompressedPubkey[1:])[-20:], затем base58check
// (двойной sha256-чек-сумма — как в Bitcoin, что и использует Tron).
const TRON_MAINNET_PREFIX = 0x41;
const b58c = base58check(sha256);

// Watch-only: из xpub деривируем только публичные ключи. Приватного тут нет.
function deriveFromXpub(xpub: string, index: number): string {
  // external chain 0, затем address index (оба non-hardened — доступны из xpub).
  const node = HDKey.fromExtendedKey(xpub).deriveChild(0).deriveChild(index);
  if (!node.publicKey) {
    throw new Error(`derivation failed for index ${index}: no public key`);
  }
  return addressFromPublicKey(node.publicKey);
}

function addressFromPublicKey(compressed: Uint8Array): string {
  // Разжимаем 33-байтный ключ в 65 байт (0x04 || x || y), берём x||y.
  const xy = secp256k1.Point.fromBytes(compressed).toBytes(false).slice(1);
  const body = keccak_256(xy).slice(-20); // последние 20 байт хеша
  const addr = new Uint8Array(21);
  addr[0] = TRON_MAINNET_PREFIX;
  addr.set(body, 1);
  return b58c.encode(addr);
}

/** Депозит-адрес по индексу деривации из настроенного TRON_XPUB. */
export function deriveDepositAddress(index: number): string {
  if (!config.TRON_XPUB) throw new Error("TRON_XPUB is not configured");
  return deriveFromXpub(config.TRON_XPUB, index);
}

// Известный тест-вектор (мнемоника BIP39 "abandon…about", m/44'/195'/0'/0/0).
// Проверен независимо: тот же алгоритм keccak(pubkey)[-20:] на ETH-пути даёт
// каноничный 0x9858…eda94. Несовпадение = неверная деривация = потеря средств.
const TEST_XPUB =
  "xpub6D1AabNHCupeiLM65ZR9UStMhJ1vCpyV4XbZdyhMZBiJXALQtmn9p42VTQckoHVn8WNqS7dqnJokZHAHcHGoaQgmv8D45oNUKx6DZMNZBCd";
const TEST_INDEX0_ADDR = "TUEZSdKsoDHQMeZwihtdoBiN46zxhGWYdH";

/** Fail-fast самопроверка деривации. Зовётся при старте, если крипта включена. */
export function selfTestDerivation(): void {
  const got = deriveFromXpub(TEST_XPUB, 0);
  if (got !== TEST_INDEX0_ADDR) {
    console.error(
      `[gateway] HD derivation self-test FAILED: expected ${TEST_INDEX0_ADDR}, got ${got}`,
    );
    process.exit(1);
  }
  console.log("[gateway] HD derivation self-test ok");
}
