import mongoose from "mongoose";
import {User} from "./models.js";
import {encryptSecret} from "./security.js";
export async function connectDatabase(){
  if(!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  mongoose.set("strictQuery",true);
  await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
  // Migrate any tokens written by older releases before enabling the new encrypted-token path.
  const users=await User.find({$or:[
    {"providers.discord.accessToken":{$exists:true,$not:/^enc:v1:/}},
    {"providers.discord.refreshToken":{$exists:true,$not:/^enc:v1:/}},
    {"providers.kick.accessToken":{$exists:true,$not:/^enc:v1:/}},
    {"providers.kick.refreshToken":{$exists:true,$not:/^enc:v1:/}},
    {"providers.twitch.accessToken":{$exists:true,$not:/^enc:v1:/}},
    {"providers.twitch.refreshToken":{$exists:true,$not:/^enc:v1:/}},
    {"providers.youtube.accessToken":{$exists:true,$not:/^enc:v1:/}},
    {"providers.youtube.refreshToken":{$exists:true,$not:/^enc:v1:/}}
  ]}).select("providers");
  for(const user of users){const set={};for(const provider of ["discord","kick","twitch","youtube"]){for(const field of ["accessToken","refreshToken"]){const value=user.providers?.[provider]?.[field];if(value&&!String(value).startsWith("enc:v1:"))set[`providers.${provider}.${field}`]=encryptSecret(value);}}if(Object.keys(set).length)await User.updateOne({_id:user._id},{$set:set});}
  if(users.length)console.log(`[Rivo Website] encrypted legacy tokens for ${users.length} account(s)`);
  console.log("[Rivo Website] MongoDB connected");
}
