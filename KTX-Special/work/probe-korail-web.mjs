import {writeFile} from 'node:fs/promises';
const initial=await fetch('https://www.korail.com/ticket/search/general',{signal:AbortSignal.timeout(20000)});
const anonymousCookies=initial.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
const query={Device:'BH',Version:'999999999',txtMenuId:'11',radJobId:'1',
  txtGoStart:'서울',txtGoEnd:'포항',txtGoAbrdDt:'20261205',txtGoHour:'083500',
  txtPsgFlg_1:'1',txtPsgFlg_2:'0',txtPsgFlg_3:'0',txtPsgFlg_4:'0',txtPsgFlg_5:'0',txtPsgFlg_8:'0',
  txtTrnGpCd:'109',selGoTrain:'109',txtSeatAttCd_4:'015',rtYn:'N',tkTripChgQryFlg:'Y',
  adjStnScdlOfrFlg:'N',adjStnScdlOfrFlg2:'N',srtCheckYn:'N',ebizCrossCheck:'N',txtWkndUseFlg:'Y'};
const payload=new FormData();
for(const [key,value] of Object.entries(query))if(value!=='0')payload.append(key,value);
const started=Date.now();
const response=await fetch('https://www.korail.com/classes/com.korail.mobile.seatMovie.ScheduleView',{
  method:'POST',body:payload,headers:anonymousCookies?{Cookie:anonymousCookies}:{},
  redirect:'manual',signal:AbortSignal.timeout(20000)
});
const body=await response.text();
let data;try{data=JSON.parse(body);}catch{}
const report={checkedAt:new Date().toISOString(),runtime:'Node on PC; not Google server',httpStatus:response.status,elapsedMs:Date.now()-started,bytes:Buffer.byteLength(body),
  strResult:data?.strResult,code:data?.h_msg_cd,message:data?.h_msg_txt,rootKeys:data&&Object.keys(data),seatLookupVerified:false};
const rows=data?.trn_infos?.trn_info;
if(data?.strResult==='SUCC'&&Array.isArray(rows)) {
  report.trains=rows.map(x=>({train:x.h_trn_no,date:x.h_dpt_dt,from:x.h_dpt_rs_stn_nm,to:x.h_arv_rs_stn_nm,time:x.h_dpt_tm,specialCode:x.h_spe_rsv_cd}));
  report.seatLookupVerified=report.trains.some(x=>Number(x.train)===259&&x.date==='20261205'&&x.time==='083500'&&x.from==='서울'&&x.to==='포항'&&['00','11','13'].includes(x.specialCode));
}
await writeFile(new URL('./korail-web-report.json',import.meta.url),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
