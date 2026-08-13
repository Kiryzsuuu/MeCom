require('dotenv').config({path:'.env'});
require('dns').setDefaultResultOrder('ipv4first'); require('dns').setServers(['8.8.8.8','1.1.1.1']);
const mongoose=require('mongoose'),jwt=require('jsonwebtoken');
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI);
  const User=require('./server/models/User');
  const sa=await User.findOne({role:'direktur_coe',statusAktif:true});
  const mgr=await User.findOne({role:{$in:['dosen','sekretaris_coe']},statusAktif:true});
  const tok=jwt.sign({id:sa._id},process.env.JWT_SECRET,{expiresIn:'1h'});
  const tokM=mgr?jwt.sign({id:mgr._id},process.env.JWT_SECRET,{expiresIn:'1h'}):null;
  const base='http://localhost:5001';
  async function j(tk,method,path,body){const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+tk,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});let d;try{d=await r.json()}catch{d=null}return{s:r.status,m:d?.message};}
  let r;
  r=await j(tok,'POST','/api/auth/verify-identity',{enik:sa.enik,password:'wrong'});console.log('verify wrongpass ->',r.s,r.m);
  r=await j(tok,'POST','/api/auth/verify-identity',{enik:'000000',password:'x'});console.log('verify wrongenik ->',r.s,r.m);
  r=await j(tok,'POST','/api/tasks/reset-data',{enik:sa.enik,password:'x',confirm:'salah'});console.log('reset wrongpass ->',r.s,r.m);
  r=await j(tok,'POST','/api/tasks/reset-data',{enik:sa.enik,password:'x',confirm:'Saya yang bertanggung jawab dalam menghapus data ini'});console.log('reset rightphrase wrongpass ->',r.s,r.m);
  if(tokM){r=await j(tokM,'POST','/api/tasks/reset-data',{enik:'x',password:'x',confirm:'x'});console.log('reset as non-super ('+mgr.role+') ->',r.s,r.m);}
  await mongoose.disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});
