import test from "node:test";
import assert from "node:assert/strict";
process.env.NODE_ENV="test";process.env.TOKEN_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const {encryptSecret,decryptSecret,safeEqual,pkcePair}=await import("../src/security.js");
test("provider secrets are authenticated and encrypted",()=>{const token="provider-access-token";const sealed=encryptSecret(token);assert.notEqual(sealed,token);assert.equal(decryptSecret(sealed),token);assert.throws(()=>decryptSecret(sealed.replace(/.$/,"x")));});
test("legacy plaintext secrets remain readable for migration",()=>assert.equal(decryptSecret("legacy-token"),"legacy-token"));
test("constant-time comparison rejects different values",()=>{assert.equal(safeEqual("same","same"),true);assert.equal(safeEqual("same","other"),false);});
test("Kick PKCE verifier and challenge are generated",()=>{const p=pkcePair();assert.ok(p.verifier.length>40);assert.ok(p.challenge.length>40);assert.notEqual(p.verifier,p.challenge);});
