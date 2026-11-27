'use client';

import React, { useEffect, useRef, useState } from 'react';
import { X, Copy, Check, Zap, Bookmark, Smartphone } from 'lucide-react';

interface BookmarkletModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'sepia' | 'light';
}

function buildBookmarkletScript(origin: string): string {
  // Self-contained compact extractor + clipboard backup + cross-window postMessage bridge
  const fnBody = `
(function(){
  var ORIGIN=${JSON.stringify(origin)};
  function norm(s){return (s||'').replace(/[\\u200b-\\u200f\\u202a-\\u202e\\u00ad\\ufeff]/g,'').replace(/\\u00a0/g,' ').replace(/\\s+([\\u0300-\\u036f])/g,'$1').normalize('NFC');}
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
      if(/nav|header|footer|sidebar|ads|ad-|comment|related|menu|widget/i.test(cls))continue;
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
  if(!target){alert('Không tìm thấy nội dung chương trên trang này.');return;}
  var clone=target.cloneNode(true);
  var junk=clone.querySelectorAll('script,style,iframe,ins,noscript,nav,footer,header,.ads,.advertisement,[class*="ads-"],[class*="comment"],[id*="comment"],[class*="related"]');
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
  var payloadStr=JSON.stringify({__audifox:1,title:title,content:content,sourceUrl:location.href});
  function fallbackCopy(str){
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
  }
  fallbackCopy(payloadStr);
  try{if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(payloadStr).catch(function(){});}catch(e){}
  var targetUrl=ORIGIN+'/?from=bookmarklet&clip=1';
  var win=window.open(targetUrl,'audifox_reader');
  if(!win){location.href=targetUrl;return;}
  var done=false,tries=0;
  function onAck(ev){
    if(ev&&ev.data&&ev.data.type==='AUDIFOX_ACK'){
      done=true;
      window.removeEventListener('message',onAck);
    }
  }
  window.addEventListener('message',onAck);
  var timer=setInterval(function(){
    if(done||tries++>=50){clearInterval(timer);window.removeEventListener('message',onAck);return;}
    try{win.postMessage({type:'AUDIFOX_IMPORT_CHAPTER',title:title,content:content,sourceUrl:location.href},'*');}catch(e){}
  },300);
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
