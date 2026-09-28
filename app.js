import {initializeApp} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-app.js";
import {getAuth,signInAnonymously} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {getDatabase,ref,set,get,update,onValue,onDisconnect,push,query,limitToLast} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-database.js";
import {firebaseConfig} from "./firebase-config.js";
const app=initializeApp(firebaseConfig),auth=getAuth(app),db=getDatabase(app);
let uid="",room="",me="",state=null,isHost=false,soundOn=true,ctx=null,amb=null,lastCd="",lastResult="",rolling=false,chatStarted=false,chatOpen=false,lastSeenChat=0,authReady=null,lobbyMusicOn=true,lobbyMusicTimer=null;
const $=x=>document.getElementById(x),show=x=>{document.querySelectorAll(".screen").forEach(e=>e.classList.remove("active"));$(x).classList.add("active")};
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])),die=n=>"⚀⚁⚂⚃⚄⚅"[n-1];
function ac(){if(!soundOn)return null;try{ctx||=new(window.AudioContext||window.webkitAudioContext)();if(ctx.state==="suspended")ctx.resume();return ctx}catch{return null}}
function tone(f,d=.08,type="square",g=.025,delay=0){const a=ac();if(!a)return;const o=a.createOscillator(),v=a.createGain();o.type=type;o.frequency.value=f;v.gain.setValueAtTime(g,a.currentTime+delay);v.gain.exponentialRampToValueAtTime(.0001,a.currentTime+delay+d);o.connect(v);v.connect(a.destination);o.start(a.currentTime+delay);o.stop(a.currentTime+delay+d)}
const click=()=>tone(620,.05,"square",.015),ready=()=>[392,523,659].forEach((f,i)=>tone(f,.13,"triangle",.025,i*.1)),win=()=>[523,659,784,1047].forEach((f,i)=>tone(f,.25,"triangle",.04,i*.1)),lose=()=>[330,277,220].forEach((f,i)=>tone(f,.3,"sawtooth",.03,i*.13));
function diceSound(){for(let i=0;i<24;i++)tone(100+Math.random()*360,.045,"square",.018,i*.04)}
function ambience(){if(amb||!soundOn)return;amb=setInterval(()=>{if(state?.status==="choosing"){tone(145,.14,"triangle",.005);tone(218,.08,"triangle",.004,.12)}},1300)}
function noAmb(){clearInterval(amb);amb=null}
function lobbyBeat(){if(!lobbyMusicOn||!soundOn||state?.status!=="lobby")return;[262,330,392,523,392,330,294,440].forEach((f,i)=>tone(f,.12,i%2?"triangle":"square",.008,i*.13));tone(1046,.08,"sine",.012,.38)}
function startLobbyMusic(){if(lobbyMusicTimer||!lobbyMusicOn)return;lobbyBeat();lobbyMusicTimer=setInterval(lobbyBeat,2600)}
function stopLobbyMusic(){clearInterval(lobbyMusicTimer);lobbyMusicTimer=null}
function loserResultSound(){
  tone(392,.16,"sawtooth",.035,0);
  tone(330,.18,"sawtooth",.035,.13);
  tone(262,.28,"triangle",.045,.27);
  tone(740,.055,"square",.014,.58);
  tone(620,.055,"square",.014,.67);
}
function jackpotSound(){[523,659,784,1047,1319].forEach((f,i)=>tone(f,.3,"triangle",.045,i*.09));for(let i=0;i<9;i++)tone(900+i*85,.055,"square",.012,.48+i*.045)}

document.addEventListener("pointerdown",e=>{ac();if(e.target.closest("button"))click()},{passive:true});
$("sound").onclick=()=>{soundOn=!soundOn;$("sound").textContent=soundOn?"🔊":"🔇";soundOn?(ready(),ambience()):noAmb()};
$("lobbyMusic").onclick=()=>{lobbyMusicOn=!lobbyMusicOn;$("lobbyMusic").textContent=lobbyMusicOn?"🎵 LOBBY MUSIC: ON":"🔇 LOBBY MUSIC: OFF";if(lobbyMusicOn){ac();startLobbyMusic()}else stopLobbyMusic()};

authReady=signInAnonymously(auth).then(c=>{uid=c.user.uid;$("status").textContent="● Online";$("create").disabled=false;$("join").disabled=false;return uid}).catch(err=>{$("status").textContent="● Connection error";console.error("Anonymous auth failed",err);throw err});
$("create").onclick=async()=>{try{$("create").disabled=true;$("create").textContent="CONNECTING…";await authReady;if(!uid)throw new Error("Not signed in");me=$("name").value.trim()||"Host";room=Math.random().toString(36).slice(2,8).toUpperCase();await set(ref(db,`rooms/${room}`),{host:uid,status:"lobby",round:0,dice:null,result:null,total:null,countdownEnd:null,history:[],created:Date.now()});await joinPlayer();watch()}catch(err){console.error(err);alert("Cannot create room. Please check internet connection and refresh the page.");$("status").textContent="● Connection error"}finally{$("create").disabled=false;$("create").textContent="CREATE ROOM"}};
$("join").onclick=async()=>{try{$("join").disabled=true;$("join").textContent="CONNECTING…";await authReady;if(!uid)throw new Error("Not signed in");me=$("name").value.trim()||"Player";room=$("roomInput").value.trim().toUpperCase();if(!room){alert("Enter room code.");return}const s=await get(ref(db,`rooms/${room}`));if(!s.exists()){alert("Room not found.");return}await joinPlayer();watch()}catch(err){console.error(err);alert("Cannot join room. Please check internet connection and refresh the page.")}finally{$("join").disabled=false;$("join").textContent="JOIN ROOM"}};
async function joinPlayer(){await set(ref(db,`rooms/${room}/players/${uid}`),{name:me,score:0,choice:"",online:true});onDisconnect(ref(db,`rooms/${room}/players/${uid}/online`)).set(false);$("roomCode").textContent=room;$("chatRoom").textContent=`Room ${room}`;$("chatDock").classList.remove("hidden");startChat();startBasketballReactions();show("lobby")}
const online=()=>Object.entries(state?.players||{}).filter(([,p])=>p.online!==false);
function watch(){onValue(ref(db,`rooms/${room}`),s=>{state=s.val();if(!state)return;isHost=state.host===uid;document.querySelectorAll(".hostOnly").forEach(e=>e.style.display=isHost?"block":"none");renderPlayers();if(state.status==="lobby"){noAmb();show("lobby");startLobbyMusic()}else{stopLobbyMusic();show("game");render();sync()}})}
function renderPlayers(){$("players").innerHTML=online().map(([id,p])=>`<div class="player"><b>${esc(p.name)}</b><small>${id===state.host?"HOST":"CONNECTED"}</small></div>`).join("")}
function render(){
 const es=online(),ps=es.map(x=>x[1]),mine=state.players?.[uid],picked=ps.filter(p=>p.choice).length,hasDice=Array.isArray(state.dice);
 const history=Array.isArray(state.history)?state.history:[];
 $("drawHistoryItems").innerHTML=history.length?history.slice(-10).reverse().map(h=>`<div class="historyItem ${h.result=== "big"?"historyBig":"historySmall"}"><span class="historyRound">R${Number(h.round)||"?"}</span><span class="historyDice">${Array.isArray(h.dice)?h.dice.map(die).join(" "):"🎲"}</span><b class="historyTotal">${Number(h.total)||"—"}</b><strong class="historySide">${h.result==="big"?"BIG":"SMALL"}</strong></div>`).join(""):'<span class="historyEmpty">No previous rounds yet</span>';
 $("round").textContent=state.round||1;$("ready").textContent=`${picked}/${ps.length} READY`;
 $("scores").innerHTML=es.sort((a,b)=>(b[1].score||0)-(a[1].score||0)).map(([id,p])=>{const cls=hasDice&&p.choice?(p.choice===state.result?" meWin":" roundLose"):"";const mark=hasDice&&p.choice?(p.choice===state.result?" ✓ WIN":" ✕ LOSE"):"";return `<div class="scoreRow${cls}"><b>${esc(p.name)}${id===uid?" • YOU":""}${mark}</b><span class="pick">${p.choice?String(p.choice).toUpperCase():"WAITING"}</span><strong>${p.score||0}</strong></div>`}).join("");
 ["small","big"].forEach(c=>{$(c).classList.toggle("selected",mine?.choice===c);$(c).classList.toggle("locked",state.status!=="choosing")});
 $("waiting").classList.toggle("hidden",!(state.status==="choosing"&&mine?.choice&&picked<ps.length));
 $("next").classList.toggle("hidden",!(isHost&&state.status==="result"));
 const losers=hasDice?es.filter(([,p])=>p.choice&&p.choice!==state.result).map(([,p])=>p.name):[];
 $("loserBoard").classList.toggle("hidden",!hasDice||!losers.length);
 $("loserNames").innerHTML=losers.map(n=>`<span class="loserChip">❌ ${esc(n)}</span>`).join("");
 if(hasDice){
  $("diceBox").innerHTML=state.dice.map(n=>`<b>${die(n)}</b>`).join("");$("total").textContent=`TOTAL ${state.total}`;$("result").textContent=`${state.result.toUpperCase()} WINS!`;$("phase").textContent="ROUND RESULT";$("subphase").textContent="Same dice on every phone";
  const won=mine?.choice===state.result;$("myResult").classList.remove("hidden");$("myResultTitle").textContent=won?"🏆 YOU WIN!":"❌ YOU LOSE!";$("myResultText").textContent=won?`${mine?.name||"Player"} • You chose ${(mine?.choice||"").toUpperCase()} ✓ • Result ${state.total} (${state.result.toUpperCase()})`:`${mine?.name||"Player"} • You chose ${(mine?.choice||"").toUpperCase()} ✕ • Result ${state.total} (${state.result.toUpperCase()}) • 🥤 HALF GLASS!`;$("halfGlass").classList.toggle("hidden",won||!mine?.choice);
 }else{
  $("diceBox").innerHTML="<b>⚀</b><b>⚀</b><b>⚀</b>";$("total").textContent="TOTAL —";$("result").textContent="";$("myResult").classList.add("hidden");
  if(state.status==="choosing"){$("phase").textContent=mine?.choice?"CHOICE LOCKED ✓":"MAKE YOUR PREDICTION";$("subphase").textContent=mine?.choice?(picked===ps.length?"Everyone ready — locking table…":`Waiting for ${ps.length-picked} player${ps.length-picked===1?"":"s"}…`):"Choose SMALL or BIG"}
  if(state.status==="countdown"){$("phase").textContent="TABLE LOCKED";$("subphase").textContent="Get ready!"}
  if(state.status==="rolling"){$("phase").textContent="ROLLING DICE";$("subphase").textContent="Here we go!"}
 }
}
function sync(){if(state.status==="choosing"){ambience();if(isHost)maybeCountdown()}else noAmb();if(state.status==="countdown")countdown();if(state.status==="rolling")rollAnim();if(state.status==="result")resultPopup()}
async function maybeCountdown(){const ps=online().map(x=>x[1]);if(ps.length&&ps.every(p=>p.choice)&&state.status==="choosing")await update(ref(db,`rooms/${room}`),{status:"countdown",countdownEnd:Date.now()+3400})}
function countdown(){const key=`${state.round}-${state.countdownEnd}`;if(lastCd===key)return;lastCd=key;const box=$("countdown"),num=$("countNum");box.classList.remove("hidden");let prev="";const t=setInterval(async()=>{if(!state||state.status!=="countdown"){clearInterval(t);box.classList.add("hidden");return}const ms=(state.countdownEnd||Date.now())-Date.now(),n=Math.max(0,Math.ceil(ms/1000)),label=n?String(n):"LOCK!";if(label!==prev){prev=label;num.textContent=label;num.style.animation="none";void num.offsetWidth;num.style.animation="pop .55s ease";tone(n===1?900:560,.13,"square",.045)}if(ms<=-350){clearInterval(t);box.classList.add("hidden");if(isHost)hostRoll()}},70)}
async function hostRoll(){if(rolling)return;rolling=true;await update(ref(db,`rooms/${room}`),{status:"rolling"});diceSound();await new Promise(r=>setTimeout(r,1250));const a=new Uint32Array(3);crypto.getRandomValues(a);const d=[...a].map(x=>x%6+1),total=d.reduce((x,y)=>x+y,0),result=total<=10?"small":"big",u={status:"result",dice:d,total,result,countdownEnd:null,history:[...(Array.isArray(state.history)?state.history:[]).slice(-9),{round:state.round||1,dice:d,total,result}]};Object.entries(state.players||{}).forEach(([id,p])=>{if(p.choice===result)u[`players/${id}/score`]=(p.score||0)+1});await update(ref(db,`rooms/${room}`),u);rolling=false}
function rollAnim(){let i=0;$("diceBox").classList.add("rolling");const t=setInterval(()=>{if(!state||state.status!=="rolling"){clearInterval(t);$("diceBox").classList.remove("rolling");return}$("diceBox").innerHTML=[1,2,3].map(()=>`<b>${die(Math.floor(Math.random()*6)+1)}</b>`).join("");if(++i===1)diceSound()},85)}
function resultPopup(){const key=`${state.round}-${(state.dice||[]).join("")}-${state.result}`;if(lastResult===key)return;lastResult=key;const mine=state.players?.[uid],won=mine?.choice===state.result;$("resultLine").textContent="FINAL DRAW";$("jackpotDice").textContent=(state.dice||[]).map(die).join(" ");$("jackpotTotal").textContent=state.total;$("jackpotWin").textContent=`${state.result.toUpperCase()} WINS!`;$("resultTitle").textContent=won?"🏆 YOU WIN!":"❌ YOU LOSE!";
$("halfGlassCard").classList.toggle("hidden",won);
$("resultChoice").textContent=`Your choice: ${(mine?.choice||"").toUpperCase()} ${won?"✓":"✕"}`;
$("loseDrawPanel").classList.toggle("hidden",won);
if(!won){
  $("loseDice").textContent=(state.dice||[]).map(die).join(" ");
  $("loseTotal").textContent=state.total;
  $("loseSide").textContent=state.result.toUpperCase();
  $("loseSide").className=`loseSide ${state.result}`;
}
$("resultCard").classList.toggle("playerWin",won);
$("resultCard").classList.toggle("playerLose",!won);$("resultIcon").textContent=won?"🎉":"🥤";$("resultMessage").textContent=won?"Great prediction!":`${mine?.name||"Player"}, your prediction lost this round.`;$("bigChallenge").classList.toggle("hidden",won||!mine?.choice);$("resultCard").classList.toggle("lose",!won&&!!mine?.choice);$("resultTakeover").classList.remove("hidden");if(won)jackpotSound();else loserResultSound();setTimeout(()=>won?win():lose(),520)}
$("dismiss").onclick=()=>$("resultTakeover").classList.add("hidden");
$("small").onclick=()=>choose("small");$("big").onclick=()=>choose("big");
async function choose(c){if(state?.status!=="choosing")return;tone(c==="small"?360:560,.14,"triangle",.035);await set(ref(db,`rooms/${room}/players/${uid}/choice`),c)}
$("start").onclick=async()=>{if(!isHost)return;ready();const u={status:"choosing",round:1,dice:null,total:null,result:null,countdownEnd:null};Object.keys(state.players||{}).forEach(id=>u[`players/${id}/choice`]="");await update(ref(db,`rooms/${room}`),u)};
$("next").onclick=async()=>{if(!isHost)return;$("resultTakeover").classList.add("hidden");lastCd="";const u={status:"choosing",round:(state.round||0)+1,dice:null,total:null,result:null,countdownEnd:null};Object.keys(state.players||{}).forEach(id=>u[`players/${id}/choice`]="");await update(ref(db,`rooms/${room}`),u);ready()};
function startChat(){if(chatStarted||!room)return;chatStarted=true;const q=query(ref(db,`rooms/${room}/messages`),limitToLast(80));onValue(q,s=>{const msgs=Object.entries(s.val()||{}).sort((a,b)=>(a[1].time||0)-(b[1].time||0));renderChat(msgs);const newest=msgs.length?(msgs[msgs.length-1][1].time||0):0;if(newest>lastSeenChat){const fresh=msgs.filter(([,m])=>(m.time||0)>lastSeenChat&&m.uid!==uid).length;if(fresh)tone(760,.06,"triangle",.012);lastSeenChat=newest}})}
function renderChat(msgs){const box=$("chatMessages");if(!msgs.length){box.innerHTML='<div class="chatEmpty">No messages yet.<br>Say hello 👋</div>';return}box.innerHTML=msgs.map(([,m])=>{const mine=m.uid===uid,t=m.time?new Date(m.time).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}):"";return `<div class="msg ${mine?"mine":""}"><div class="msgMeta">${mine?"YOU":esc(m.name)} • ${t}</div><div class="msgBubble">${esc(m.text)}</div></div>`}).join("");requestAnimationFrame(()=>box.scrollTop=box.scrollHeight)}
async function sendChat(){const i=$("chatInput"),t=i.value.trim();if(!t||!room||!uid)return;i.value="";await push(ref(db,`rooms/${room}/messages`),{uid,name:me,text:t.slice(0,180),time:Date.now()})}
$("chatSend").onclick=sendChat;$("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();sendChat()}});


const emojiBtn=$("emojiBtn"),emojiPicker=$("emojiPicker");
if(emojiBtn&&emojiPicker){
 emojiBtn.onclick=(e)=>{e.stopPropagation();emojiPicker.classList.toggle("hidden")};
 emojiPicker.querySelectorAll("button").forEach(b=>b.onclick=()=>{
   const em=b.textContent;
   const inp=$("chatInput");
   if(inp){inp.value=(inp.value||"")+em;inp.focus()}
   emojiPicker.classList.add("hidden");
   if(["😂","🤣","🔥","🎲","🎉","💥","🏆","😱"].includes(em)){
     const f=document.createElement("div");f.className="floatingReaction";f.textContent=em;
     document.body.appendChild(f);setTimeout(()=>f.remove(),1350);
   }
 });
 document.addEventListener("click",e=>{if(!emojiPicker.contains(e.target)&&e.target!==emojiBtn)emojiPicker.classList.add("hidden")});
}


// V16 — Firebase-synced basketball penguin sticker for everyone in the room
let basketballReactionsStarted=false;
let lastBasketballReactionKey="";
function showBasketballSticker(){
  const layer=$("basketballAnimationLayer");
  if(!layer)return;
  const sticker=document.createElement("img");
  sticker.src="basketball-dribble.gif";
  sticker.alt="";
  sticker.className="basketballPartySticker";
  layer.appendChild(sticker);
  setTimeout(()=>sticker.remove(),5300);
}
function startBasketballReactions(){
  if(basketballReactionsStarted||!room)return;
  basketballReactionsStarted=true;
  const q=query(ref(db,`rooms/${room}/reactions`),limitToLast(1));
  onValue(q,s=>{
    const entries=Object.entries(s.val()||{});
    if(!entries.length)return;
    const [key,r]=entries[entries.length-1];
    if(key===lastBasketballReactionKey)return;
    lastBasketballReactionKey=key;
    if(Date.now()-(r?.time||0)<15000){
      if(r?.type==="basketball")showBasketballSticker();
      if(r?.type==="dance")showDanceSticker();
    }
  });
}
const basketballStickerBtn=$("basketballStickerBtn");
if(basketballStickerBtn){
  basketballStickerBtn.addEventListener("click",async()=>{
    if(!room||!uid)return;
    try{
      await push(ref(db,`rooms/${room}/reactions`),{type:"basketball",uid,name:me,time:Date.now()});
    }catch(err){console.error("Basketball sticker failed",err)}
  });
}

// V17 — Firebase-synced dancing sticker for everyone in the room
function showDanceSticker(){
  const layer=$("basketballAnimationLayer");
  if(!layer)return;
  const sticker=document.createElement("img");
  sticker.src="dancing_girl.gif";
  sticker.alt="";
  sticker.className="dancePartySticker";
  layer.appendChild(sticker);
  setTimeout(()=>sticker.remove(),4800);
}
const danceStickerBtn=$("danceStickerBtn");
if(danceStickerBtn){
  danceStickerBtn.addEventListener("click",async()=>{
    if(!room||!uid)return;
    try{
      await push(ref(db,`rooms/${room}/reactions`),{type:"dance",uid,name:me,time:Date.now()});
    }catch(err){console.error("Dance sticker failed",err)}
  });
}
