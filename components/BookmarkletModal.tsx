'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, Zap, Bookmark, Smartphone } from 'lucide-react';

interface BookmarkletModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'sepia' | 'light';
}

function buildBookmarkletScript(origin: string): string {
  // Self-contained compact extractor + clipboard backup + floating Auto Next bridge for SPA readers (e.g. lanagarden.com/reader/*)
  const fnBody = `
(function(){
  var ORIGIN=${JSON.stringify(origin)};
  if(window.__audifoxBridge&&typeof window.__audifoxBridge.sendNow==='function'){
    window.__audifoxBridge.sendNow();
    return;
  }
  function norm(s){return (s||'').replace(/[\\u200b-\\u200f\\u202a-\\u202e\\u00ad\\ufeff]/g,'').replace(/\\u00a0/g,' ').replace(/\\s+([\\u0300-\\u036f])/g,'$1').normalize('NFC');}
  function extractChapter(){
    var titleEl=document.querySelector('h1.chapter-title,h2.chapter-title,.chapter-title,.truyen-title,h1,h2');
    var title=norm(titleEl?titleEl.textContent:document.title).trim();
    if(title.length>200)title=title.slice(0,200);
    var sels=['#chapter-c','.chapter-c','#content','.reading-content','#vung_doc','.entry-content','.chapter-content','#chapter-content','.prose .whitespace-pre-wrap','.prose','article'];
    var target=null;
    for(var i=0;i<sels.length;i++){
      var el=document.querySelector(sels[i]);
      if(el&&el.textContent&&el.textContent.trim().length>200){target=el;break;}
    }
    if(!target){
      var bestScore=0,cands=document.querySelectorAll('div,article,section');
      for(var j=0;j<cands.length;j++){
        var c=cands[j],cls=(c.className||'')+' '+(c.id||'');
        if(c.id==='audifox-bridge-bar'||/nav|header|footer|sidebar|ads|ad-|comment|related|menu|widget/i.test(cls))continue;
        var txt=c.textContent?c.textContent.trim():'';
        if(txt.length<200)continue;
        var skip=false;
        for(var k=0;k<c.children.length;k++){
          if(c.children[k].textContent&&c.children[k].textContent.trim().length>=txt.length*0.85){skip=true;break;}
        }
        if(skip)continue;
        var vi=(txt.match(/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi)||[]).length;
        if(vi>bestScore){bestScore=vi;target=c;}
      }
    }
    if(!target)return null;
    var clone=target.cloneNode(true);
    var junk=clone.querySelectorAll('script,style,iframe,ins,noscript,nav,footer,header,.ads,.advertisement,[class*="ads-"],[class*="comment"],[id*="comment"],[class*="related"],#audifox-bridge-bar');
    for(var m=0;m<junk.length;m++)junk[m].remove();
    var brs=clone.querySelectorAll('br');
    for(var b=0;b<brs.length;b++)brs[b].replaceWith(document.createTextNode('\\n'));
    var ps=clone.querySelectorAll('p');
    var content='';
    if(ps.length>3){
      var arr=[];
      for(var p=0;p<ps.length;p++){var pt=norm(ps[p].textContent).replace(/[ \\t]+/g,' ').trim();if(pt)arr.push(pt);}
      content=arr.join('\\n\\n');
    }else{
      content=norm(clone.textContent).split(/\\r?\\n+/).map(function(l){return l.replace(/[ \\t]+/g,' ').trim();}).filter(Boolean).join('\\n\\n');
    }
    if(title){
      var lt=title.toLowerCase(),lines=content.split('\\n\\n');
      while(lines.length>1&&(lines[0].toLowerCase()===lt||lt.indexOf(lines[0].toLowerCase())!==-1)){lines.shift();}
      content=lines.join('\\n\\n');
    }
    return {title:title,content:content};
  }
  function findContinueReadingButton(){
    var els=document.querySelectorAll('button,a,[role="button"],span,div');
    for(var i=0;i<els.length;i++){
      var node=els[i];
      if(node.closest('#audifox-bridge-bar'))continue;
      if(node.offsetParent===null&&(!node.getClientRects||node.getClientRects().length===0))continue;
      var t=norm(node.innerText||node.textContent).trim().replace(/\\s+/g,' ');
      if(!t||t.length>50)continue;
      if(/tiếp tục đọc/i.test(t)){
        var clickEl=node.closest('button,a,[role="button"]')||node;
        if(!isDisabled(clickEl))return {textNode:node,buttonNode:clickEl};
      }
    }
    return null;
  }
  function dispatchFullClick(el){
    if(!el)return;
    var targets=[el];
    var btn=el.closest?el.closest('button,a,[role="button"]'):null;
    if(btn&&btn!==el)targets.push(btn);
    var evNames=['pointerdown','mousedown','pointerup','mouseup','click'];
    for(var i=0;i<targets.length;i++){
      var t=targets[i];
      for(var e=0;e<evNames.length;e++){
        try{
          var name=evNames[e];
          var Ev=(name.indexOf('pointer')===0&&typeof PointerEvent!=='undefined')?PointerEvent:MouseEvent;
          t.dispatchEvent(new Ev(name,{bubbles:true,cancelable:true,view:window}));
        }catch(err){}
      }
      try{if(typeof t.click==='function')t.click();}catch(err){}
    }
  }
  function isInterstitial(ex){
    if(findContinueReadingButton())return true;
    if(!ex)return false;
    var head=(ex.title||'')+' '+ex.content.slice(0,220);
    if(/^quảng cáo$/i.test((ex.title||'').trim()))return true;
    if(ex.content.length<450&&/quảng cáo/i.test(head)&&/tiếp tục đọc/i.test(head))return true;
    return false;
  }
  function isDisabled(el){
    return !el||el.disabled||el.getAttribute('aria-disabled')==='true'||/disabled/i.test(el.className||'');
  }
  function isInPagination(el){
    var p=el.parentElement;
    for(var d=0;d<3&&p;d++,p=p.parentElement){
      var pt=norm(p.innerText||p.textContent).trim().replace(/\\s+/g,' ');
      var pc=(p.className||'')+' '+(p.getAttribute('aria-label')||'');
      if(/pagination/i.test(pc)||(pt.length<80&&/\\b\\d+\\s*\\/\\s*\\d+\\b/.test(pt)))return true;
    }
    return false;
  }
  function getChapterListItems(){
    var els=document.querySelectorAll('button,a,[role="button"],li,div');
    var items=[];
    for(var i=0;i<els.length;i++){
      var el=els[i];
      if(el.closest('#audifox-bridge-bar')||isInPagination(el))continue;
      if(el.offsetParent===null&&(!el.getClientRects||el.getClientRects().length===0))continue;
      var t=norm(el.innerText||el.textContent).trim().replace(/\\s+/g,' ');
      if(!t||t.length>120)continue;
      if(/^(?:chương|hồi|chapter)\\s+\\d+/i.test(t)){
        var hasInnerMatch=false;
        var children=el.querySelectorAll('button,a,[role="button"],li,div');
        for(var c=0;c<children.length;c++){
          var ct=norm(children[c].innerText||children[c].textContent).trim().replace(/\\s+/g,' ');
          if(/^(?:chương|hồi|chapter)\\s+\\d+/i.test(ct)){hasInnerMatch=true;break;}
        }
        if(!hasInnerMatch){
          var clickEl=el.closest('button,a,[role="button"]')||el;
          if(items.indexOf(clickEl)===-1)items.push(clickEl);
        }
      }
    }
    return items;
  }
  function parseChapNum(str){
    var m=/(?:chương|hồi|chapter)\\s+(\\d+)/i.exec(str||'');
    return m?parseInt(m[1],10):null;
  }
  function findNextChapterTarget(){
    var curTitleEl=document.querySelector('h1.chapter-title,h2.chapter-title,.chapter-title,.truyen-title,h1,h2');
    var curTitle=norm(curTitleEl?(curTitleEl.innerText||curTitleEl.textContent):document.title).trim().replace(/\\s+/g,' ');
    var curNum=parseChapNum(curTitle);
    var chapItems=getChapterListItems();
    var activeIdx=-1;
    for(var k=0;k<chapItems.length;k++){
      var ch=chapItems[k];
      var ct=norm(ch.innerText||ch.textContent).trim().replace(/\\s+/g,' ');
      var cItemNum=parseChapNum(ct);
      var cls=(ch.className||'')+' '+((ch.parentElement&&ch.parentElement.className)||'');
      var isAct=(curNum!==null&&cItemNum===curNum)||ch.getAttribute('aria-current')==='page'||ch.getAttribute('aria-current')==='true'||ch.getAttribute('aria-selected')==='true'||ch.getAttribute('data-active')==='true'||/(active|current|selected)/i.test(cls);
      if(isAct){
        activeIdx=k;
        if(curNum===null&&cItemNum!==null)curNum=cItemNum;
        break;
      }
    }
    if(curNum!==null){
      for(var n=0;n<chapItems.length;n++){
        var nt=norm(chapItems[n].innerText||chapItems[n].textContent).trim().replace(/\\s+/g,' ');
        var nNum=parseChapNum(nt);
        if(nNum!==null&&nNum===curNum+1&&!isDisabled(chapItems[n])){
          return {el:chapItems[n]};
        }
      }
    }else if(activeIdx>=0&&activeIdx<chapItems.length-1&&!isDisabled(chapItems[activeIdx+1])){
      return {el:chapItems[activeIdx+1]};
    }
    var candidates=document.querySelectorAll('button,a,[role="button"],span,div');
    for(var j=0;j<candidates.length;j++){
      var node=candidates[j];
      if(node.closest('#audifox-bridge-bar')||isInPagination(node))continue;
      var t=norm(node.innerText||node.textContent).trim().replace(/\\s+/g,' ');
      if(!t||t.length>40)continue;
      if(/^Sau(\\s*[>›»])?$/i.test(t)||/^Chương\\s*(sau|tiếp)/i.test(t)){
        var clickEl=node.closest('button,a,[role="button"]')||node;
        if(!isDisabled(clickEl))return {el:clickEl};
      }
    }
    return null;
  }
  function copyToClipboard(str){
    try{
      var ta=document.createElement('textarea');
      ta.value=str;
      ta.setAttribute('readonly','');
      ta.style.position='fixed';ta.style.opacity='0';ta.style.left='-9999px';
      document.body.appendChild(ta);
      ta.select();ta.setSelectionRange(0,str.length);
      document.execCommand('copy');
      document.body.removeChild(ta);
    }catch(e){}
    try{if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(str).catch(function(){});}catch(e){}
  }
  var autoNext=false;
  try{autoNext=sessionStorage.getItem('audifox_auto_next')==='1';}catch(e){}
  var win=null,bc=null,navLock=false,lastSentSig='',sendTimer=null,waitTimer=null,waitObs=null;
  try{if(typeof BroadcastChannel!=='undefined'){bc=new BroadcastChannel('audifox-bridge');}}catch(e){}
  var bar=document.createElement('div');
  bar.id='audifox-bridge-bar';
  bar.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483647;display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:9999px;background:rgba(14,16,26,0.94);color:#F3F4F6;border:1px solid rgba(139,92,246,0.45);box-shadow:0 8px 24px rgba(0,0,0,0.4);font:600 12px/1.2 system-ui,-apple-system,sans-serif;backdrop-filter:blur(8px)';
  var statusSpan=document.createElement('span');
  statusSpan.textContent='Audifox';
  statusSpan.style.cssText='color:#C4B5FD;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  var toggleBtn=document.createElement('button');
  toggleBtn.type='button';
  function renderToggle(){
    toggleBtn.textContent=autoNext?'Auto Next: ON':'Auto Next: OFF';
    toggleBtn.style.cssText='cursor:pointer;border:1px solid '+(autoNext?'#8B5CF6':'rgba(255,255,255,0.18)')+';background:'+(autoNext?'rgba(139,92,246,0.28)':'rgba(255,255,255,0.06)')+';color:'+(autoNext?'#F5F3FF':'#D1D5DB')+';padding:4px 9px;border-radius:9999px;font:600 11px/1 system-ui,sans-serif;';
  }
  renderToggle();
  var nextBtn=document.createElement('button');
  nextBtn.type='button';
  nextBtn.textContent='Chương tiếp ▶';
  nextBtn.style.cssText='cursor:pointer;border:none;background:#7C3AED;color:#fff;padding:4px 10px;border-radius:9999px;font:600 11px/1 system-ui,sans-serif;';
  var closeBtn=document.createElement('button');
  closeBtn.type='button';
  closeBtn.textContent='×';
  closeBtn.style.cssText='cursor:pointer;border:none;background:transparent;color:#9CA3AF;padding:2px 5px;font:700 14px/1 system-ui,sans-serif;';
  bar.appendChild(statusSpan);
  bar.appendChild(toggleBtn);
  bar.appendChild(nextBtn);
  bar.appendChild(closeBtn);
  document.body.appendChild(bar);
  function sendChapter(extracted){
    if(!extracted||!extracted.content)return false;
    lastSentSig=extracted.content.slice(0,180)+'::'+location.href;
    var sendId=Date.now()+'-'+Math.random().toString(36).slice(2,7);
    var msgPayload={type:'AUDIFOX_IMPORT_CHAPTER',title:extracted.title,content:extracted.content,sourceUrl:location.href,bridgeAutoNext:autoNext,sendId:sendId};
    if(!document.hidden){
      copyToClipboard(JSON.stringify({__audifox:1,title:extracted.title,content:extracted.content,sourceUrl:location.href,bridgeAutoNext:autoNext,sendId:sendId}));
    }
    var targetUrl=ORIGIN+'/?from=bookmarklet&clip=1';
    if(!win||win.closed){win=window.open(targetUrl,'audifox_reader');}
    if(!win){location.href=targetUrl;return true;}
    statusSpan.textContent='Đã đồng bộ';
    if(bc){try{bc.postMessage(msgPayload);}catch(e){}}
    try{win.postMessage(msgPayload,'*');}catch(e){}
    if(sendTimer){clearInterval(sendTimer);sendTimer=null;}
    var done=false,tries=0;
    function onAck(ev){
      if(ev&&ev.data&&ev.data.type==='AUDIFOX_ACK'){
        done=true;
        window.removeEventListener('message',onAck);
        statusSpan.textContent=autoNext?'Đã đồng bộ (Auto Next)':'Đã đồng bộ';
      }
    }
    window.addEventListener('message',onAck);
    sendTimer=setInterval(function(){
      if(done||tries++>=20){clearInterval(sendTimer);sendTimer=null;window.removeEventListener('message',onAck);return;}
      if(bc){try{bc.postMessage(msgPayload);}catch(e){}}
      try{win.postMessage(msgPayload,'*');}catch(e){}
    },250);
    return true;
  }
  function triggerNextChapter(){
    if(navLock)return;
    var target=findNextChapterTarget();
    if(!target||!target.el){statusSpan.textContent='Hết chương';return;}
    navLock=true;
    var prevHref=location.href;
    var prevExtract=extractChapter();
    var prevSnippet=prevExtract?prevExtract.content.slice(0,180):'';
    statusSpan.textContent='Đang chuyển chương...';
    if(waitTimer){clearInterval(waitTimer);waitTimer=null;}
    if(waitObs){waitObs.disconnect();waitObs=null;}
    var startTime=Date.now();
    var settledStarted=false;
    var lastContinueClickAt=0;
    function cleanupWait(){
      if(waitTimer){clearInterval(waitTimer);waitTimer=null;}
      if(waitObs){waitObs.disconnect();waitObs=null;}
      navLock=false;
    }
    function checkFresh(){
      var contPair=findContinueReadingButton();
      if(Date.now()-startTime>10000){
        cleanupWait();
        statusSpan.textContent=contPair?'Cần bấm Tiếp tục đọc':'Đã đồng bộ';
        return;
      }
      if(contPair){
        statusSpan.textContent='Đang chuyển chương...';
        if(Date.now()-lastContinueClickAt>=380){
          lastContinueClickAt=Date.now();
          dispatchFullClick(contPair.textNode);
        }
        return;
      }
      var cur=extractChapter();
      if(!cur||cur.content.length<120||isInterstitial(cur))return;
      var curSnippet=cur.content.slice(0,180);
      var sig=curSnippet+'::'+location.href;
      if((location.href!==prevHref||curSnippet!==prevSnippet)&&sig!==lastSentSig){
        if(settledStarted)return;
        settledStarted=true;
        setTimeout(function(){
          var finalExtract=extractChapter();
          if(findContinueReadingButton()||isInterstitial(finalExtract)){
            settledStarted=false;
            statusSpan.textContent='Đang chuyển chương...';
            return;
          }
          cleanupWait();
          if(finalExtract&&finalExtract.content.length>=120){
            sendChapter(finalExtract);
          }else{
            statusSpan.textContent='Đã đồng bộ';
          }
        },280);
      }
    }
    try{
      waitObs=new MutationObserver(checkFresh);
      waitObs.observe(document.body,{childList:true,subtree:true,characterData:true});
    }catch(e){}
    waitTimer=setInterval(checkFresh,250);
    dispatchFullClick(target.el);
  }
  toggleBtn.addEventListener('click',function(){
    autoNext=!autoNext;
    try{sessionStorage.setItem('audifox_auto_next',autoNext?'1':'0');}catch(e){}
    renderToggle();
    if(win&&!win.closed){
      try{win.postMessage({type:'AUDIFOX_BRIDGE_STATE',autoNext:autoNext},'*');}catch(e){}
    }
  });
  nextBtn.addEventListener('click',triggerNextChapter);
  function onBridgeMsg(ev){
    if(!ev||!ev.data)return;
    if(ev.data.type==='AUDIFOX_REQUEST_NEXT_CHAPTER'){
      triggerNextChapter();
    }
  }
  window.addEventListener('message',onBridgeMsg);
  if(bc){bc.addEventListener('message',onBridgeMsg);}
  closeBtn.addEventListener('click',function(){
    if(sendTimer)clearInterval(sendTimer);
    if(waitTimer)clearInterval(waitTimer);
    if(waitObs)waitObs.disconnect();
    window.removeEventListener('message',onBridgeMsg);
    if(bc){try{bc.close();}catch(e){}}
    delete window.__audifoxBridge;
    bar.remove();
  });
  window.__audifoxBridge={
    sendNow:function(){
      var ex=extractChapter();
      if(!ex){alert('Không tìm thấy nội dung chương trên trang này.');return;}
      sendChapter(ex);
    }
  };
  window.__audifoxBridge.sendNow();
})();`.replace(/\n\s*/g, '');

  return `javascript:${fnBody}`;
}

export default function BookmarkletModal({ isOpen, onClose, theme }: BookmarkletModalProps) {
  const [bookmarkletUrl, setBookmarkletUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const dragLinkRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const code = buildBookmarkletScript(window.location.origin);
    setBookmarkletUrl(code);
  }, [isOpen]);

  useEffect(() => {
    if (dragLinkRef.current && bookmarkletUrl) {
      dragLinkRef.current.setAttribute('href', bookmarkletUrl);
    }
  }, [bookmarkletUrl]);

  if (!isOpen) return null;

  async function handleCopy() {
    if (!bookmarkletUrl) return;
    try {
      await navigator.clipboard.writeText(bookmarkletUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback copy
      const ta = document.createElement('textarea');
      ta.value = bookmarkletUrl;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4">
      <div
        className={`w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl p-4 sm:p-6 shadow-2xl border ${
          theme === 'dark'
            ? 'bg-[#222434] border-white/10 text-[#F3F4F6]'
            : theme === 'sepia'
              ? 'bg-amber-50 border-amber-300 text-amber-950'
              : 'bg-white border-gray-200 text-gray-900'
        }`}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Zap className="text-amber-400 shrink-0" size={20} />
            <h3 className="font-bold text-base sm:text-lg">Nút đọc 1-Click (Bookmarklet)</h3>
          </div>
          <button onClick={onClose} className="opacity-70 hover:opacity-100 p-1">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs sm:text-sm opacity-80 mb-4 leading-relaxed">
          Gửi thẳng chương truyện bạn đang mở (kể cả chương cần đăng nhập) sang Audifox và tự động đọc ngay.
        </p>

        {/* PC Draggable Bookmarklet */}
        <div
          className={`rounded-xl border border-dashed p-3.5 mb-4 text-center ${
            theme === 'dark'
              ? 'border-indigo-500/40 bg-indigo-950/30'
              : theme === 'sepia'
                ? 'border-amber-500/50 bg-amber-100/70'
                : 'border-indigo-300 bg-indigo-50'
          }`}
        >
          <p className="text-xs opacity-75 mb-2">
            <strong>Trên Máy tính (PC):</strong> Kéo nút này thả lên thanh Dấu trang (<kbd className="px-1 py-0.5 rounded bg-black/20 text-[10px]">Ctrl+Shift+B</kbd>)
          </p>
          <a
            ref={dragLinkRef}
            onClick={(e) => e.preventDefault()}
            draggable
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold shadow-md cursor-grab active:cursor-grabbing select-none"
          >
            <Bookmark size={15} />
            Đọc trên Audifox
          </a>
        </div>

        {/* Update Notice */}
        <div
          className={`rounded-xl border px-3.5 py-2.5 mb-4 text-xs leading-relaxed ${
            theme === 'dark'
              ? 'border-amber-500/30 bg-amber-500/10 text-amber-200/90'
              : theme === 'sepia'
                ? 'border-amber-500/40 bg-amber-100 text-amber-950'
                : 'border-violet-300 bg-violet-50 text-violet-950'
          }`}
        >
          Lưu ý: Mỗi khi Audifox cập nhật tính năng mới cho Bookmarklet (hoặc đổi giữa localhost và bản web chính thức), bạn cần kéo/lưu đè lại dấu trang mới trên cả PC và điện thoại để áp dụng.
        </div>

        {/* Mobile Instructions */}
        <div
          className={`rounded-xl border p-3.5 mb-4 ${
            theme === 'dark'
              ? 'border-gray-800 bg-gray-800/50'
              : theme === 'sepia'
                ? 'border-amber-300 bg-amber-100/40'
                : 'border-gray-200 bg-gray-50'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <h4 className="font-semibold text-sm flex items-center gap-1.5">
              <Smartphone size={15} className="text-indigo-400 shrink-0" />
              Cách dùng trên Điện thoại (iOS / Android)
            </h4>
          </div>

          <button
            onClick={handleCopy}
            className="w-full mb-3 px-3.5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
          >
            {copied ? <Check size={16} className="text-emerald-300" /> : <Copy size={16} />}
            {copied ? 'Đã copy!' : '📋 Copy mã Bookmarklet'}
          </button>

          <ol className="text-xs sm:text-sm space-y-2 list-decimal list-inside opacity-90 leading-relaxed">
            <li>
              Lưu dấu trang (Bookmark) một trang web bất kỳ trên Safari/Chrome và đổi tên thành <code className="px-1.5 py-0.5 rounded bg-black/20 font-mono text-xs">doc</code>.
            </li>
            <li>
              Sửa dấu trang <code className="px-1.5 py-0.5 rounded bg-black/20 font-mono text-xs">doc</code> đó và dán mã <code className="px-1 py-0.5 rounded bg-black/20 font-mono text-xs">javascript:...</code> vừa copy vào ô URL.
            </li>
            <li>
              Khi đang đọc chương truyện đã đăng nhập trên điện thoại, chạm vào thanh địa chỉ, gõ <code className="px-1.5 py-0.5 rounded bg-black/20 font-mono text-xs">doc</code> và chọn dấu trang để gửi sang Audifox nghe ngay.
            </li>
          </ol>
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-current/20 text-sm font-medium hover:bg-black/10"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
