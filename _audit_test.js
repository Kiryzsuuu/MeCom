require('dotenv').config({path:'.env'});
require('dns').setDefaultResultOrder('ipv4first');
require('dns').setServers(['8.8.8.8','1.1.1.1']);
const mongoose=require('mongoose');
const jwt=require('jsonwebtoken');
(async()=>{
  await mongoose.connect(process.env.MONGODB_URI);
  const User=require('./server/models/User');
  const sa=await User.findOne({role:'direktur_coe',statusAktif:true});
  if(!sa){console.log('no direktur_coe');process.exit(0);}
  const tok=jwt.sign({id:sa._id},process.env.JWT_SECRET,{expiresIn:'1h'});
  console.log('DIREKTUR_COE', sa.namaLengkap, '| enik:', sa.enik, '| email:', sa.email);
  const base='http://localhost:5001';
  const H={Authorization:'Bearer '+tok,'Content-Type':'application/json'};
  async function j(method,path,body){
    const r=await fetch(base+path,{method,headers:H,body:body?JSON.stringify(body):undefined});
    let d; try{d=await r.json()}catch{d=null}
    return {s:r.status,d};
  }
  let r;
  r=await j('GET','/api/tasks/pending-approval'); console.log('pending-approval:',r.s,'tasks=',r.d?.tasks?.length,'subtasks=',r.d?.subtasks?.length);
  r=await j('GET','/api/tasks?limit=2'); console.log('tasks list:',r.s,'total=',r.d?.total,'sampleHasSubtaskTotal=', r.d?.tasks?.[0]?.subtaskTotal!==undefined);
  r=await j('POST','/api/auth/verify-identity',{enik:sa.enik||sa.email,password:'definitely-wrong'}); console.log('verify wrong pass:',r.s,r.d?.message);
  r=await j('POST','/api/tasks/reset-data',{enik:sa.enik||sa.email,password:'x',confirm:'salah'}); console.log('reset wrong:',r.s,r.d?.message);
  r=await j('POST','/api/tasks/reset-data',{}); console.log('reset empty:',r.s,r.d?.message);
  await mongoose.disconnect();
})().catch(e=>{console.error(e.message);process.exit(1)});
