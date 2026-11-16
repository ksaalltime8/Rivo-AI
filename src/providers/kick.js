import crypto from "node:crypto";
let cachedKey=null,cachedAt=0;
export async function kickPublicKey(){if(cachedKey&&Date.now()-cachedAt<3600000)return cachedKey;const r=await fetch("https://api.kick.com/public/v1/public-key");if(!r.ok)throw new Error(`Kick public key request failed: ${r.status}`);cachedKey=await r.text();cachedAt=Date.now();return cachedKey;}
export async function verifyKickWebhook(headers,rawBody){
 const id=headers["kick-event-message-id"],timestamp=headers["kick-event-message-timestamp"],signature=headers["kick-event-signature"];
 if(!id||!timestamp||!signature)return false;
 const when=Date.parse(timestamp);if(!Number.isFinite(when)||Math.abs(Date.now()-when)>5*60*1000)return false;
 const key=await kickPublicKey();const verifier=crypto.createVerify("RSA-SHA256");verifier.update(`${id}.${timestamp}.${rawBody}`);verifier.end();
 return verifier.verify(key,Buffer.from(signature,"base64"));
}
export async function kickSendMessage(content){
 if(!process.env.KICK_ACCESS_TOKEN||!process.env.KICK_CHANNEL_ID)throw new Error("KICK_ACCESS_TOKEN and KICK_CHANNEL_ID are required");
 const r=await fetch("https://api.kick.com/public/v1/chat",{method:"POST",headers:{Authorization:`Bearer ${process.env.KICK_ACCESS_TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({content:String(content).slice(0,500),type:"bot",broadcaster_user_id:Number(process.env.KICK_CHANNEL_ID)})});
 if(!r.ok)throw new Error(`Kick chat API failed: ${r.status} ${await r.text()}`);return r.json();
}
