// NeuroStream — Lampa Plugin v1.0

(function() {
  'use strict';

  var Defined = {
    api: 'lampac',
    localhost: 'rezka://',
    apn: ''
  };

  var balansers_with_search;
  
  var unic_id = Lampa.Storage.get('lampac_unic_id', '');
  if (!unic_id) {
    unic_id = Lampa.Utils.uid(8).toLowerCase();
    Lampa.Storage.set('lampac_unic_id', unic_id);
  }
  

  function addHeaders() {
    var bwaesgcmkey = Lampa.Storage.get('bwaesgcmkey', '');
    if (bwaesgcmkey) return { 'X-Kit-AesGcm': Lampa.Storage.get('bwaesgcmkey', '') };
    return {};
  }
  
  // ═══════════════════════════════════════════════════════════════
  //  NeuroStream — Direct Engine
  //
  //  GET:  Lampa.Reguest.native() — loads page, sets session cookies
  //  POST: Lampa.Reguest.native() with URL-encoded string body
  //  decode: trashList approach from Lampa's own plugin
  //
  //  Add mirrors to RZKA_PROVIDERS — tried in order, first working
  //  one is cached in localStorage key 'neurostream_provider'.
  // ═══════════════════════════════════════════════════════════════

  var RZKA_PROVIDERS = ['https://rezka-ua.org','https://hdrezka.name','https://hdrezka.me','https://hdrezka-home.tv','https://hdrezka.co','https://hdrezka.website','http://hdrezka.ink','https://hdrezka.today','https://hdrezka.tv','https://hdrezka.rest','https://hdrezka.loan','https://hdrezka.city'];
  var _rzka_provider = Lampa.Storage.get('neurostream_provider', '');

  function _rzkaUA() {
    return 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36';
  }

  function _rzkaHeaders(provider) {
    var b = provider || _rzka_provider || RZKA_PROVIDERS[0];
    return { 'User-Agent': _rzkaUA(), 'Referer': b + '/', 'Origin': b };
  }

  // ── Provider probe ────────────────────────────────────────────
  function _rzkaEnsureProvider(ok, fail) {
    if (_rzka_provider) return ok(_rzka_provider);
    var list = RZKA_PROVIDERS.slice();
    function tryNext() {
      if (!list.length) { Lampa.Storage.set('neurostream_provider',''); return fail('Nav derīgu hipersaišu'); }
      var p = list.shift();
      var net = new Lampa.Reguest(); net.timeout(8000);
      net['native'](p+'/', function() {
        _rzka_provider = p; Lampa.Storage.set('neurostream_provider', p); ok(p);
      }, function() { tryNext(); }, false, { dataType:'text', headers:{'User-Agent':_rzkaUA()} });
    }
    tryNext();
  }

  // ── GET via Lampa.Reguest.native() ──────────────────────────────
  function _rzkaGet(path, params, ok, fail) {
    _rzkaEnsureProvider(function(provider) {
      var url = provider + path;
      if (params && Object.keys(params).length)
        url += '?' + Object.keys(params).map(function(k) {
          return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
        }).join('&');
      var net = new Lampa.Reguest(); net.timeout(20000);
      net['native'](url, ok, fail, false, { dataType:'text', headers:_rzkaHeaders(provider) });
    }, fail);
  }

  // ── POST via Lampa.Reguest.native() ──────────────────────────────
  // Body as URL-encoded STRING — Lampa sends it raw, PHP $_POST parses correctly.
  // Android HTTP stack carries session cookies from the prior GET automatically.
  function _rzkaPost(provider, path, data, ok, fail) {
    provider = provider || _rzka_provider || RZKA_PROVIDERS[0];
    var url = provider + path + '/?t=' + Date.now();
    var body = Object.keys(data).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(String(data[k]));
    }).join('&');
    var net = new Lampa.Reguest(); net.timeout(20000);
    net['native'](url, function(t) {
      console.log('[NeuroStream] POST ok:', (typeof t==='string'?t:JSON.stringify(t)).slice(0,200));
      ok(t);
    }, function(e) {
      console.warn('[NeuroStream] POST fail:', e&&e.status);
      fail(e&&e.status?('HTTP '+e.status):'network error');
    }, body, { dataType:'text', headers:{ 'Content-Type':'application/x-www-form-urlencoded' } });
  }


  // ── Decode (from Lampa's own plugin) ─────────────
  function _rzkaDecodeStream(data) {
    function product(arr, repeat) {
      var copies = []; for (var i=0; i<repeat; i++) copies.push(arr.slice());
      return copies.reduce(function(acc,val){
        var tmp=[];
        acc.forEach(function(a){val.forEach(function(b){tmp.push(a.concat(b));});});
        return tmp;
      },[[]]); }
    function unite(arr){return arr.map(function(e){return e.join('');});}
    var trashList=['@','#','!','^','$'];
    var trashCodes=unite(product(trashList,2)).concat(unite(product(trashList,3)));
    var arr=data.replace('#h','').split('//_//');
    var trashString=arr.join('');
    trashCodes.forEach(function(i){trashString=trashString.replace(new RegExp(btoa(i),'g'),'');});
    try{return atob(trashString.substr(2));}catch(e){return '';}
  }

  function _rzkaParseStreams(raw) {
    if (!raw) return null;
    // If encrypted (#h prefix) — decode first. Otherwise use as-is.
    var dec = (raw.indexOf('#h') === 0) ? _rzkaDecodeStream(raw) : raw;
    if (!dec) return null;
    // Parse comma-separated quality list: [1080p]url1 or url2,[720p]url3,...
    var qualitys = {}, first = '';
    var pref = String(Lampa.Storage.get('video_quality_default','1080'));
    dec.split(',').forEach(function(str) {
      str = str.trim();
      var cb = str.indexOf(']'); if (cb === -1) return;
      var q = str.substring(1, cb).replace(/<[^>]*>/g,'').trim();
      var rest = str.substring(cb + 1).trim();
      // Pick first URL before ' or '
      var u = rest.indexOf(' or ') !== -1 ? rest.split(' or ')[0].trim() : rest;
      // Fix malformed URLs: https:////stream -> https://stream
      u = u.replace(/https?:\/+/, function(m) { return m.replace(/\/+/, '//'); });
      if (!u) return;
      var k = q.replace(/[^0-9]/g,'');
      if (k && !qualitys[k]) qualitys[k] = u;
      if (!first) first = u;
      if (pref && q.indexOf(pref) >= 0) first = u;
    });
    if (!first) return null;
    return { url: first, quality: qualitys };
  }

  // ── HTML helpers ──────────────────────────────────────────────
  function _rzkaDoc(h){try{return (new DOMParser()).parseFromString(h,'text/html');}catch(e){var d=document.createElement('div');d.innerHTML=h;return d;}}
  function _rzkaQs(el,sel){try{return el.querySelector(sel);}catch(e){return null;}}
  function _rzkaQsa(el,sel){try{return [].slice.call(el.querySelectorAll(sel));}catch(e){return[];}}
  function _escH(s){return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

  function _parseRzkaUrl(url) {
    if (!url||url.indexOf('rezka://')!==0) return null;
    var ns=url.slice('rezka://'.length),qm=ns.indexOf('?');
    var scheme=qm===-1?ns:ns.slice(0,qm),params={};
    if(qm!==-1) ns.slice(qm+1).split('&').forEach(function(pair){
      var eq=pair.indexOf('=');
      if(eq!==-1) params[decodeURIComponent(pair.slice(0,eq))]=decodeURIComponent(pair.slice(eq+1).replace(/\+/g,' '));
    });
    return {scheme:scheme,params:params};
  }

  // ── Search ────────────────────────────────────────────────────
  function _rzkaSearch(title, origTitle, year, isSerial, ok, fail) {
    var queries=[];
    if (origTitle&&origTitle!==title) queries.push(origTitle);
    queries.push(title);
    function tryQuery(idx) {
      if (idx>=queries.length) return fail('not_found');
      _rzkaGet('/search/', {do:'search',subaction:'search',q:queries[idx]}, function(html) {
        _rzkaPickResult(html,year,isSerial,ok,function(){tryQuery(idx+1);});
      }, function(){tryQuery(idx+1);});
    }
    tryQuery(0);
  }

  function _rzkaPickResult(html,year,isSerial,ok,fail){
    var items=_rzkaQsa(_rzkaDoc(html),'.b-content__inline_item');
    if(!items.length) return fail('not_found');
    var s1=null,s2=null,s3=null,s4=null;
    for(var i=0;i<items.length;i++){
      var link=_rzkaQs(items[i],'.b-content__inline_item-link a');if(!link)continue;
      if(!s4)s4=link;
      var info=((_rzkaQs(items[i],'.b-content__inline_item-link div')||{}).textContent||'');
      var iy=(info.match(/\b(19|20)\d{2}\b/)||[])[0]||'';
      var cat=((_rzkaQs(items[i],'.cat')||{}).getAttribute('class')||'');
      var ser=cat.indexOf('series')!==-1||cat.indexOf('animation')!==-1||cat.indexOf('show')!==-1||cat.indexOf('anime')!==-1;
      var ym=year&&iy?String(iy)===String(year):!year;
      var tm=isSerial===ser;
      if(ym&&tm&&!s1)s1=link;if(ym&&!tm&&!s2)s2=link;if(!ym&&tm&&!s3)s3=link;
    }
    var best=s1||s2||s3||s4;if(!best)return fail('not_found');
    ok((best.getAttribute('href')||'').replace(/^https?:\/\/[^/]+/,''));
  }

  // ── Film page ─────────────────────────────────────────────────
  function _rzkaPage(href, ok, fail) {
    _rzkaGet(href, {}, function(html) {
      var doc=_rzkaDoc(html);
      var fav=_rzkaQs(doc,'#user-favorites-holder');
      var filmId=fav?(fav.getAttribute('data-post_id')||''):'';
      if(!filmId){var m=html.match(/["']id["']\s*:\s*["']?(\d+)["']?/);if(m)filmId=m[1];}
      var og=_rzkaQs(doc,'meta[property="og:type"]');
      var isMovie=!!(og&&(og.getAttribute('content')||'').indexOf('video.movie')!==-1);
      var voices=[];
      _rzkaQsa(doc,'.b-translator__item').forEach(function(el){
        var cls=el.getAttribute('class')||'';
        voices.push({id:el.getAttribute('data-translator_id')||'',
          title:(el.getAttribute('title')||el.textContent||'').trim(),
          isCamrip:el.getAttribute('data-camrip')||'0',
          isDirector:el.getAttribute('data-director')||'0',
          isAds:el.getAttribute('data-ad')||'0',
          isActive:cls.indexOf('active')!==-1});
      });
      var seasons=_rzkaParseSeasonsDom(doc);
      // Extract favs token from inline JS
      var favs='', inline=null;
      try {
        var mk=isMovie?'initCDNMoviesEvents':'initCDNSeriesEvents';
        var si=html.indexOf(mk);
        if(si!==-1){
          var ji=html.indexOf('{"id"',si);if(ji===-1)ji=html.indexOf('{"url"',si);
          if(ji!==-1){
            var je=html.indexOf('});',si);
            var obj=JSON.parse(html.substring(ji,je+1));
            favs=obj.favs||'';
            if(!voices.length){
              inline=obj;
              if(!isMovie){var tid=(html.substring(si,ji).split(',')[1]||'').trim();voices=[{id:tid,title:'Noklusējums',isCamrip:'0',isDirector:'0',isAds:'0',isActive:true}];}
            }
          }
        }
      }catch(e){console.warn('[NeuroStream] inline',e);}
      console.log('[NeuroStream] page filmId='+filmId+' voices='+voices.length+' favs='+(favs?'YES':'NO'));
      ok({filmId:filmId,isMovie:isMovie,voices:voices,seasons:seasons,inline:inline,favs:favs,provider:_rzka_provider});
    },fail);
  }

  function _rzkaParseSeasonsDom(doc){
    var seasons=[],lS,lE;
    var si=_rzkaQsa(doc,'.b-simple_season__item');
    si.forEach(function(el){
      var sid=el.getAttribute('data-tab_id'),eps=[];
      _rzkaQsa(doc,'#simple-episodes-list-'+sid+' .b-simple_episode__item').forEach(function(ep){
        if((ep.getAttribute('class')||'').indexOf('active')!==-1){lS=ep.getAttribute('data-season_id');lE=ep.getAttribute('data-episode_id');}
        eps.push({id:ep.getAttribute('data-episode_id'),name:ep.textContent.trim()});
      });
      seasons.push({id:sid,name:el.textContent.trim(),episodes:eps});
    });
    if(!si.length){
      var eps=[];
      _rzkaQsa(doc,'.b-simple_episode__item').forEach(function(el){
        if((el.getAttribute('class')||'').indexOf('active')!==-1){lS=el.getAttribute('data-season_id');lE=el.getAttribute('data-episode_id');}
        eps.push({id:el.getAttribute('data-episode_id'),name:el.textContent.trim()});
      });
      if(eps.length)seasons.push({id:'1',name:'',episodes:eps});
    }
    return {seasons:seasons,lS:lS,lE:lE};
  }

  // ── HTML builders ─────────────────────────────────────────────
  function _rzkaVoiceButtons(voices,filmId,activeId,seasonId,favs,provider,isMovie){
    return voices.map(function(v){
      var url='rezka://voice?filmId='+filmId+'&voiceId='+encodeURIComponent(v.id)+'&voiceTitle='+encodeURIComponent(v.title)+'&isCamrip='+(v.isCamrip||'0')+'&isAds='+(v.isAds||'0')+'&isDir='+(v.isDirector||'0')+'&favs='+encodeURIComponent(favs||'')+'&provider='+encodeURIComponent(provider||_rzka_provider||'');
      if(seasonId)url+='&seasonId='+encodeURIComponent(seasonId);
      if(isMovie)url+='&isMovie=1';
      var active=v.id===activeId;
      return '<div class="videos__button'+(active?' active':'')+'" data-json="'+_escH(JSON.stringify({url:url,text:v.title,active:active}))+'">'+_escH(v.title)+'</div>';
    }).join('');
  }

  function _rzkaEpisodeItems(episodes,voice,filmId,seasonId,favs,provider){
    return episodes.map(function(ep){
      var url='rezka://stream?filmId='+filmId+'&voiceId='+encodeURIComponent(voice.id)+'&voiceTitle='+encodeURIComponent(voice.title)+'&isCamrip='+(voice.isCamrip||'0')+'&isAds='+(voice.isAds||'0')+'&isDir='+(voice.isDirector||'0')+'&seasonId='+encodeURIComponent(seasonId)+'&episodeId='+encodeURIComponent(ep.id)+'&favs='+encodeURIComponent(favs||'')+'&provider='+encodeURIComponent(provider||_rzka_provider||'');
      var data={url:url,method:'call',text:ep.name||('Sērija '+ep.id),season:parseInt(seasonId)||1,episode:parseInt(ep.id)||1,voice_name:voice.title};
      return '<div class="videos__item" s="'+seasonId+'" e="'+ep.id+'" data-json="'+_escH(JSON.stringify(data))+'">'+_escH(ep.name||('Sērija '+ep.id))+'</div>';
    }).join('');
  }

  function _rzkaMovieHtml(voices,filmId,activeId,activeUrl,activeQuality,title,favs,provider){
    var btns=_rzkaVoiceButtons(voices,filmId,activeId,null,favs,provider);
    var items=voices.map(function(v){
      var isActive=v.id===activeId;
      var url=isActive?activeUrl:'rezka://stream?filmId='+filmId+'&voiceId='+encodeURIComponent(v.id)+'&voiceTitle='+encodeURIComponent(v.title)+'&isCamrip='+(v.isCamrip||'0')+'&isAds='+(v.isAds||'0')+'&isDir='+(v.isDirector||'0')+'&action=get_movie&favs='+encodeURIComponent(favs||'')+'&provider='+encodeURIComponent(provider||_rzka_provider||'');
      var q=isActive?activeQuality:{};
      return '<div class="videos__item'+(isActive?' active':'')+'" data-json="'+_escH(JSON.stringify({url:url,quality:q,method:'play',voice_name:v.title}))+'">'+_escH(title)+'</div>';
    }).join('');
    return btns+items;
  }

  // ── Page cache ────────────────────────────────────────────────
  var _rzkaCache={};
  function _rzkaFindCached(filmId){for(var k in _rzkaCache)if(_rzkaCache[k]&&_rzkaCache[k].filmId===filmId)return _rzkaCache[k];return null;}

  // ── Series HTML builder ───────────────────────────────────────
  function _rzkaSeriesHtml(data,voice,seasonId){
    var sd=data.seasons,voices=data.voices,filmId=data.filmId,favs=data.favs,provider=data.provider;
    if(!sd||!sd.seasons||!sd.seasons.length)return null;

    // Find the season with most episodes (active season from page DOM)
    var bestSeason=null;
    sd.seasons.forEach(function(s){if(!bestSeason||s.episodes.length>bestSeason.episodes.length)bestSeason=s;});
    var targetSeason=seasonId?sd.seasons.filter(function(s){return s.id===seasonId;})[0]:null;
    targetSeason=targetSeason||bestSeason||sd.seasons[0];

    var btns=_rzkaVoiceButtons(voices,filmId,voice.id,targetSeason.id,favs,provider);

    if(sd.seasons.length===1){
      return btns+_rzkaEpisodeItems(targetSeason.episodes,voice,filmId,targetSeason.id,favs,provider);
    }

    // Multi-season, no episodes in page DOM — show season links (episode load on select)
    var items=sd.seasons.map(function(s){
      var url='rezka://season?filmId='+filmId+'&seasonId='+encodeURIComponent(s.id)+'&seasonName='+encodeURIComponent(s.name||'')+'&voiceId='+encodeURIComponent(voice.id)+'&voiceTitle='+encodeURIComponent(voice.title)+'&isCamrip='+(voice.isCamrip||'0')+'&isAds='+(voice.isAds||'0')+'&isDir='+(voice.isDirector||'0')+'&favs='+encodeURIComponent(favs||'')+'&provider='+encodeURIComponent(provider||_rzka_provider||'');
      return '<div class="videos__item" s="'+s.id+'" data-json="'+_escH(JSON.stringify({url:url,method:'link',text:s.name||('Sezona '+s.id)}))+'">'+_escH(s.name||('Sezona '+s.id))+'</div>';
    }).join('');
    return btns+items;
  }

  // ── Main dispatch ─────────────────────────────────────────────
  function _rzkaDispatch(url,onParsed,onError){
    var parsed=_parseRzkaUrl(url);if(!parsed)return onError('Nepareiza saite');
    var p=parsed.params;
    console.log('[NeuroStream] dispatch '+parsed.scheme+' '+JSON.stringify(p).slice(0,120));

    if(parsed.scheme==='search'){
      var isSerial=p.serial==='1',year=(p.year&&p.year!=='0000')?p.year:'';
      var title=p.title||'',origTitle=p.original_title||'';
      var cacheKey=(origTitle||title)+'|'+year+'|'+isSerial;
      if(_rzkaCache[cacheKey])return _rzkaHandlePage(_rzkaCache[cacheKey],p,isSerial,onParsed,onError);
      _rzkaSearch(title,origTitle,year,isSerial,function(href){
        _rzkaPage(href,function(data){
          data.isMovie=!isSerial;_rzkaCache[cacheKey]=data;
          _rzkaHandlePage(data,p,isSerial,onParsed,onError);
        },function(e){console.warn('[NeuroStream] page',e);onError('Lapas ielādes kļūda');});
      },function(e){console.warn('[NeuroStream] search',e);onError('Rezka: nav atrasts');});

    }else if(parsed.scheme==='voice'){
      var data=_rzkaFindCached(p.filmId);
      var allVoices=data?data.voices.map(function(v){return{id:v.id,title:v.title,isCamrip:v.isCamrip||'0',isAds:v.isAds||'0',isDirector:v.isDirector||'0',isActive:v.id===p.voiceId};}):[];
      var voice={id:p.voiceId,title:p.voiceTitle,isCamrip:p.isCamrip||'0',isAds:p.isAds||'0',isDirector:p.isDir||'0',isActive:true};
      if(!allVoices.length)allVoices=[voice];
      var favs=p.favs||'',provider=p.provider||_rzka_provider||RZKA_PROVIDERS[0];
      if(p.isMovie==='1'){
        _rzkaPost(provider,'/ajax/get_cdn_series',{id:p.filmId,translator_id:p.voiceId,is_camrip:voice.isCamrip,is_ads:voice.isAds,is_director:voice.isDirector,action:'get_movie',favs:favs},function(t){
          var j=typeof t==='object'?t:(function(){try{return JSON.parse(t);}catch(e){return null;}}());
          if(!j||!j.success)return onError(j?j.message:'Kļūda');
          var s=_rzkaParseStreams(j.url);if(!s)return onError('Atšifrēšanas kļūda');
          var btns=_rzkaVoiceButtons(allVoices,p.filmId,voice.id,null,favs,provider,true);
          var items=allVoices.map(function(v){
            var isAct=v.id===voice.id;
            var iu=isAct?s.url:('rezka://stream?filmId='+p.filmId+'&voiceId='+encodeURIComponent(v.id)+'&voiceTitle='+encodeURIComponent(v.title)+'&isCamrip='+(v.isCamrip||'0')+'&isAds='+(v.isAds||'0')+'&isDir='+(v.isDirector||'0')+'&action=get_movie&favs='+encodeURIComponent(favs)+'&provider='+encodeURIComponent(provider));
            var iq=isAct?s.quality:{};
            return '<div class="videos__item'+(isAct?' active':'')+'" data-json="'+_escH(JSON.stringify({url:iu,quality:iq,method:isAct?'play':'call',text:v.title,voice_name:v.title,info:''}))+'">'+_escH(v.title)+'</div>';
          }).join('');
          onParsed(btns+items);
        },onError);
        return;
      }
      _rzkaPost(provider,'/ajax/get_cdn_series',{id:p.filmId,translator_id:p.voiceId,action:'get_episodes',favs:favs},function(t){
        var j=typeof t==='object'?t:(function(){try{return JSON.parse(t);}catch(e){return null;}}());
        var sd;
        if(j&&(j.seasons||j.episodes)){sd=_rzkaParseSeasonsDom(_rzkaDoc('<div>'+(j.seasons||'')+(j.episodes||'')+'</div>'));if(data)data.seasons=sd;}
        else sd=data&&data.seasons;
        if(!sd||!sd.seasons||!sd.seasons.length)return onError('Nav sezonu datu');
        if(p.seasonId){
          var season=sd.seasons.filter(function(s){return s.id===p.seasonId;})[0]||sd.seasons[0];
          return onParsed(_rzkaVoiceButtons(allVoices,p.filmId,voice.id,season.id,favs,provider)+_rzkaEpisodeItems(season.episodes,voice,p.filmId,season.id,favs,provider));
        }
        var html=_rzkaSeriesHtml({seasons:sd,voices:allVoices,filmId:p.filmId,favs:favs,provider:provider},voice,null);
        if(!html)return onError('Nav datu');
        onParsed(html);
      },function(){
        if(data){
          var html=_rzkaSeriesHtml(data,voice,p.seasonId||null);
          if(html)return onParsed(html);
        }
        onError('Sēriju ielādes kļūda');
      });

    }else if(parsed.scheme==='season'){
      var data2=_rzkaFindCached(p.filmId);
      var allVoices2=data2?data2.voices.map(function(v){return{id:v.id,title:v.title,isCamrip:v.isCamrip||'0',isAds:v.isAds||'0',isDirector:v.isDirector||'0',isActive:v.id===p.voiceId};}):[];
      var voice2={id:p.voiceId,title:p.voiceTitle,isCamrip:p.isCamrip||'0',isAds:p.isAds||'0',isDirector:p.isDir||'0',isActive:true};
      if(!allVoices2.length)allVoices2=[voice2];
      var favs2=p.favs||'',provider2=p.provider||_rzka_provider||RZKA_PROVIDERS[0];
      // Try from cache first
      if(data2&&data2.seasons){
        var season=data2.seasons.seasons.filter(function(s){return s.id===p.seasonId;})[0];
        if(season&&season.episodes.length)
          return onParsed(_rzkaVoiceButtons(allVoices2,p.filmId,voice2.id,season.id,favs2,provider2)+_rzkaEpisodeItems(season.episodes,voice2,p.filmId,season.id,favs2,provider2));
      }
      _rzkaPost(provider2,'/ajax/get_cdn_series',{id:p.filmId,translator_id:p.voiceId,action:'get_episodes',favs:favs2},function(t){
        var j=typeof t==='object'?t:(function(){try{return JSON.parse(t);}catch(e){return null;}}());
        if(!j)return onError('Nav datu');
        var sd=_rzkaParseSeasonsDom(_rzkaDoc('<div>'+(j.seasons||'')+(j.episodes||'')+'</div>'));
        if(data2)data2.seasons=sd;
        var season=sd.seasons.filter(function(s){return s.id===p.seasonId;})[0]||sd.seasons[0];
        if(!season)return onError('Sezona nav atrasta');
        onParsed(_rzkaVoiceButtons(allVoices2,p.filmId,voice2.id,season.id,favs2,provider2)+_rzkaEpisodeItems(season.episodes,voice2,p.filmId,season.id,favs2,provider2));
      },function(){
        if(data2&&data2.seasons){
          var s2=data2.seasons.seasons.filter(function(s){return s.id===p.seasonId;})[0]||data2.seasons.seasons[0];
          if(s2)return onParsed(_rzkaVoiceButtons(allVoices2,p.filmId,voice2.id,s2.id,favs2,provider2)+_rzkaEpisodeItems(s2.episodes,voice2,p.filmId,s2.id,favs2,provider2));
        }
        onError('Nav sezonu datu');
      });
    }else{
      onError('Nezināma komanda: '+parsed.scheme);
    }
  }

  function _rzkaHandlePage(data,p,isSerial,onParsed,onError){
    var movieTitle = p.title||p.original_title||'';
    console.log('[NeuroStream] handlePage isSerial='+isSerial+' voices='+data.voices.length+' inline='+(!!data.inline)+' filmId='+data.filmId);

    // Determine active voice (used by both movie and series branches)
    var activeVoice = data.voices.length ? (data.voices.filter(function(v){return v.isActive;})[0]||data.voices[0]) : null;

    if(!isSerial){
      // Movie: inline stream with no voices → play directly
      if(!data.voices.length){
        if(data.inline){
          var s=_rzkaParseStreams(data.inline.url||data.inline.streams||'');
          if(s){
            onParsed('<div class="videos__item active" data-json="'+_escH(JSON.stringify({url:s.url,quality:s.quality,method:'play',voice_name:'',info:''}))+'">'+_escH(movieTitle)+'</div>');
            return;
          }
        }
        return onError('Nav tulkojumu');
      }
      // Has voices — show one block per voice, deferred (stream fetched via getFileUrl on click)
      // Use voice.title as item text so parseJsonDate sets data.text = voice name (shown in UI)
      // and data.voice_name is set correctly for each item
      var btns=_rzkaVoiceButtons(data.voices,data.filmId,activeVoice.id,null,data.favs,data.provider,true);
      var items=data.voices.map(function(v){
        var url='rezka://stream?filmId='+data.filmId+'&voiceId='+encodeURIComponent(v.id)+'&voiceTitle='+encodeURIComponent(v.title)+'&isCamrip='+(v.isCamrip||'0')+'&isAds='+(v.isAds||'0')+'&isDir='+(v.isDirector||'0')+'&action=get_movie&favs='+encodeURIComponent(data.favs||'')+'&provider='+encodeURIComponent(data.provider||_rzka_provider||'');
        // Use voice title as text so rc.js parseJsonDate sets data.text = voice name
        // This makes each block show the correct voice name instead of all showing the movie title
        var isActive = v.id===activeVoice.id;
        return '<div class="videos__item'+(isActive?' active':'')+'" data-json="'+_escH(JSON.stringify({url:url,method:'call',text:v.title,voice_name:v.title,info:''}))+'">'+_escH(v.title)+'</div>';
      }).join('');
      onParsed(btns+items);
      return;
    }else{
      if(!activeVoice) return onError('Nav tulkojumu');
      _rzkaPost(data.provider,'/ajax/get_cdn_series',
        {id:data.filmId,translator_id:activeVoice.id,action:'get_episodes',favs:data.favs||''},
        function(t){
          var j=typeof t==='object'?t:(function(){try{return JSON.parse(t);}catch(e){return null;}}());
          if(j&&(j.seasons||j.episodes))data.seasons=_rzkaParseSeasonsDom(_rzkaDoc('<div>'+(j.seasons||'')+(j.episodes||'')+'</div>'));
          var html=_rzkaSeriesHtml(data,activeVoice,null);
          if(!html)return onError('Nav sezonu datu');
          onParsed(html);
        },function(){
          var html=_rzkaSeriesHtml(data,activeVoice,null);
          if(html)onParsed(html);else onError('Nav sezonu datu');
        });
    }
  }


  var Network = Lampa.Reguest;

  function component(object) {
    var network = new Network();
    var scroll = new Lampa.Scroll({
      mask: true,
      over: true
    });
    var files = new Lampa.Explorer(object);
    var filter = new Lampa.Filter(object);
    var sources = {};
    var last;
    var source;
    var balanser;
    var initialized;
    var balanser_timer;
    var images = [];
    var number_of_requests = 0;
    var number_of_requests_timer;
    var life_wait_times = 0;
    var life_wait_timer;
    var filter_sources = {};
    var filter_translate = {
      season: Lampa.Lang.translate('torrent_serial_season'),
      voice: Lampa.Lang.translate('torrent_parser_voice'),
      source: Lampa.Lang.translate('settings_rest_source')
    };
    var filter_find = {
      season: [],
      voice: []
    };
	
    if (balansers_with_search == undefined) { balansers_with_search = []; }
	
    function balanserName(j) {
      var bals = j.balanser;
      var name = j.name.split(' ')[0];
      return (bals || name).toLowerCase();
    }
	
	function clarificationSearchAdd(value){
		var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
		all[id] = value;
		
		Lampa.Storage.set('clarification_search',all);
	}
	
	function clarificationSearchDelete(){
		var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
		delete all[id];
		
		Lampa.Storage.set('clarification_search',all);
	}
	
	function clarificationSearchGet(){
		var id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
		return all[id];
	}
	
    this.initialize = function() {
      var _this = this;
      this.loading(true);
      filter.onSearch = function(value) {
		  
		clarificationSearchAdd(value);
		
        Lampa.Activity.replace({
          search: value,
          clarification: true,
          similar: true
        });
      };
      filter.onBack = function() {
        _this.start();
      };
      filter.render().find('.selector').on('hover:enter', function() {
        clearInterval(balanser_timer);
      });
      filter.render().find('.filter--search').appendTo(filter.render().find('.torrent-filter'));
      filter.onSelect = function(type, a, b) {
        if (type == 'filter') {
          if (a.reset) {
			  clarificationSearchDelete();
			  
            _this.replaceChoice({
              season: 0,
              voice: 0,
              voice_url: '',
              voice_name: ''
            });
            setTimeout(function() {
              Lampa.Select.close();
              Lampa.Activity.replace({
				  clarification: 0,
				  similar: 0
			  });
            }, 10);
          } else {
            var url = filter_find[a.stype][b.index].url;
            var choice = _this.getChoice();
            if (a.stype == 'voice') {
              choice.voice_name = filter_find.voice[b.index].title;
              choice.voice_url = url;
            }
            choice[a.stype] = b.index;
            _this.saveChoice(choice);
            _this.reset();
            _this.request(url);
            setTimeout(Lampa.Select.close, 10);
          }
        } else if (type == 'sort') {
          Lampa.Select.close();
          object.lampac_custom_select = a.source;
          _this.changeBalanser(a.source);
        }
      };
      if (filter.addButtonBack) filter.addButtonBack();
      filter.render().find('.filter--sort span').text(Lampa.Lang.translate('lampac_balanser'));
      scroll.body().addClass('torrent-list');
      files.appendFiles(scroll.render());
      files.appendHead(filter.render());
      scroll.minus(files.render().find('.explorer__files-head'));
      scroll.body().append(Lampa.Template.get('lampac_content_loading'));
      Lampa.Controller.enable('content');
      this.loading(false);
	  if(object.balanser){
		  files.render().find('.filter--search').remove();
		  sources = {};
		  sources[object.balanser] = {name: object.balanser};
		  balanser = object.balanser;
		  filter_sources = [];
		  
		  return network["native"](account(object.url.replace('rjson=','nojson=')), this.parse.bind(this), function(){
			  files.render().find('.torrent-filter').remove();
			  _this.empty();
		  }, false, {
            dataType: 'text',
			headers: addHeaders()
		  });
	  } 
      this.externalids().then(function() {
        return _this.createSource();
      }).then(function(json) {
        filter.render().find('.filter--search').addClass('hide');
        _this.search();
      })["catch"](function(e) {
        _this.noConnectToServer(e);
      });
    };
    this.rch = function(json, noreset) {
      var _this2 = this;
	  rchRun(json, function() {
        if (!noreset) _this2.find();
        else noreset();
	  });
    };
    this.externalids = function() { return Promise.resolve(); };
    this.updateBalanser = function(balanser_name) {
      var last_select_balanser = Lampa.Storage.cache('online_last_balanser', 3000, {});
      last_select_balanser[object.movie.id] = balanser_name;
      Lampa.Storage.set('online_last_balanser', last_select_balanser);
    };
    this.changeBalanser = function(balanser_name) {
      this.updateBalanser(balanser_name);
      Lampa.Storage.set('online_balanser', balanser_name);
      var to = this.getChoice(balanser_name);
      var from = this.getChoice();
      if (from.voice_name) to.voice_name = from.voice_name;
      this.saveChoice(to, balanser_name);
      Lampa.Activity.replace();
    };
    this.requestParams = function(url) {
      var query = [];
      var card_source = object.movie.source || 'tmdb'; //Lampa.Storage.field('source')
      query.push('id=' + encodeURIComponent(object.movie.id));
      if (object.movie.imdb_id) query.push('imdb_id=' + (object.movie.imdb_id || ''));
      if (object.movie.kinopoisk_id) query.push('kinopoisk_id=' + (object.movie.kinopoisk_id || ''));
	  if (object.movie.tmdb_id) query.push('tmdb_id=' + (object.movie.tmdb_id || ''));
      query.push('title=' + encodeURIComponent(object.clarification ? object.search : object.movie.title || object.movie.name));
      query.push('original_title=' + encodeURIComponent(object.movie.original_title || object.movie.original_name));
      query.push('serial=' + (object.movie.name ? 1 : 0));
      query.push('original_language=' + (object.movie.original_language || ''));
      query.push('year=' + ((object.movie.release_date || object.movie.first_air_date || '0000') + '').slice(0, 4));
      query.push('source=' + card_source);
      query.push('clarification=' + (object.clarification ? 1 : 0));
      query.push('similar=' + (object.similar ? true : false));
      query.push('rchtype=' + (((window.rch_nws && window.rch_nws[hostkey]) ? window.rch_nws[hostkey].type : (window.rch && window.rch[hostkey]) ? window.rch[hostkey].type : '') || ''));
      if (Lampa.Storage.get('account_email', '')) query.push('cub_id=' + Lampa.Utils.hash(Lampa.Storage.get('account_email', '')));
      return url + (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
    };
    this.getLastChoiceBalanser = function() {
      var last_select_balanser = Lampa.Storage.cache('online_last_balanser', 3000, {});
      if (last_select_balanser[object.movie.id]) {
        return last_select_balanser[object.movie.id];
      } else {
        return Lampa.Storage.get('online_balanser', filter_sources.length ? filter_sources[0] : '');
      }
    };
    this.startSource = function(json) {
      return new Promise(function(resolve, reject) {
        json.forEach(function(j) {
          var name = balanserName(j);
          sources[name] = {
            url: j.url,
            name: j.name,
            show: typeof j.show == 'undefined' ? true : j.show
          };
        });
        filter_sources = Lampa.Arrays.getKeys(sources);
        if (filter_sources.length) {
          var last_select_balanser = Lampa.Storage.cache('online_last_balanser', 3000, {});
          if (last_select_balanser[object.movie.id]) {
            balanser = last_select_balanser[object.movie.id];
          } else {
            balanser = Lampa.Storage.get('online_balanser', filter_sources[0]);
          }
          if (!sources[balanser]) balanser = filter_sources[0];
          if (!sources[balanser].show && !object.lampac_custom_select) balanser = filter_sources[0];
          source = sources[balanser].url;
          Lampa.Storage.set('active_balanser', balanser);
          resolve(json);
        } else {
          reject();
        }
      });
    };
    this.createSource = function() {
      return this.startSource([{name:'NeuroStream', balanser:'neurostream', url: Defined.localhost + 'search', show:true}]);
    };
    /**
     * Подготовка  */
    this.create = function() {
      return this.render();
    };
    /**
     * Начать поиск
     */
    this.search = function() { //this.loading(true)
      this.filter({
        source: filter_sources
      }, this.getChoice());
      this.find();
    };
    this.find = function() {
      this.request(this.requestParams(source));
    };
    this.request = function(url) {
      var _self = this;
      number_of_requests++;
      if (number_of_requests >= 10) { this.empty(); return; }
      clearTimeout(number_of_requests_timer);
      number_of_requests_timer = setTimeout(function() { number_of_requests = 0; }, 4000);
      var rzIdx = url ? url.indexOf('rezka://') : -1;
      if (rzIdx !== -1) {
        _rzkaDispatch(url.slice(rzIdx),
          function(html) { number_of_requests = 0; _self.parse(html); },
          function(e) { number_of_requests = 0; _self.doesNotAnswer({message: typeof e==='string'?e:'Kļūda'}); }
        );
        return;
      }
    };    this.parseJsonDate = function(str, name) {
      try {
        var html = $('<div>' + str + '</div>');
        var elems = [];
        html.find(name).each(function() {
          var item = $(this);
          var data = JSON.parse(item.attr('data-json'));
          var season = item.attr('s');
          var episode = item.attr('e');
          var text = item.text();
          if (!object.movie.name) {
            if (text.match(/\d+p/i)) {
              if (!data.quality) {
                data.quality = {};
                data.quality[text] = data.url;
              }
              text = object.movie.title;
            }
            if (text == 'Noklusējums') {
              text = object.movie.title;
            }
          }
          if (episode) data.episode = parseInt(episode);
          if (season) data.season = parseInt(season);
          if (text) data.text = text;
          data.active = item.hasClass('active');
          elems.push(data);
        });
        return elems;
      } catch (e) {
        return [];
      }
    };
    this.getFileUrl = function(file, call, waiting_rch) {
      if (file.method == 'play') { call(file, {}); return; }
      var rzIdx = file.url ? file.url.indexOf('rezka://stream') : -1;
      if (rzIdx !== -1) {
        var rp = _parseRzkaUrl(file.url.slice(rzIdx));
        if (!rp) { call(false, {}); return; }
        var p = rp.params;
        Lampa.Loading.start(function() { Lampa.Loading.stop(); Lampa.Controller.toggle('content'); network.clear(); });
        var pd = p.action === 'get_movie'
          ? {id:p.filmId, translator_id:p.voiceId, is_camrip:p.isCamrip||'0', is_ads:p.isAds||'0', is_director:p.isDir||'0', action:'get_movie', favs:p.favs||''}
          : {id:p.filmId, translator_id:p.voiceId, season:p.seasonId, episode:p.episodeId, action:'get_stream', favs:p.favs||''};
        _rzkaPost(p.provider, '/ajax/get_cdn_series', pd, function(t) {
          Lampa.Loading.stop();
          console.log('[NeuroStream] stream:', t ? t.slice(0,200) : 'empty');
          var j = typeof t==='object'?t:(function(){try{return JSON.parse(t);}catch(e){return null;}}());
          if (!j||!j.success) { Lampa.Noty.show(j&&j.message?j.message:Lampa.Lang.translate('lampac_nolink')); call(false,{}); return; }
          var s = _rzkaParseStreams(j.url);
          if (!s) { Lampa.Noty.show(Lampa.Lang.translate('lampac_nolink')); call(false,{}); return; }
          call({url:s.url, quality:s.quality}, {url:s.url, quality:s.quality});
        }, function(e) { Lampa.Loading.stop(); Lampa.Noty.show(Lampa.Lang.translate('lampac_nolink')); call(false,{}); });
        return;
      }
    };
    this.toPlayElement = function(file) {
      var play = {
        title: file.title,
        url: file.url,
        quality: file.qualitys,
        timeline: file.timeline,
        subtitles: file.subtitles,
		segments: file.segments,
        callback: file.mark,
		season: file.season,
		episode: file.episode,
		voice_name: file.voice_name,
		thumbnail: file.thumbnail
      };
      return play;
    };
    this.orUrlReserve = function(data) {
      if (data.url && typeof data.url == 'string' && data.url.indexOf(" or ") !== -1) {
        var urls = data.url.split(" or ");
        data.url = urls[0];
        data.url_reserve = urls[1];
      }
    };
    this.setDefaultQuality = function(data) {
      if (Lampa.Arrays.getKeys(data.quality).length) {
        for (var q in data.quality) {
          if (parseInt(q) == Lampa.Storage.field('video_quality_default')) {
            data.url = data.quality[q];
            this.orUrlReserve(data);
          }
          if (data.quality[q].indexOf(" or ") !== -1)
            data.quality[q] = data.quality[q].split(" or ")[0];
        }
      }
    };
    this.display = function(videos) {
      var _this5 = this;
      this.draw(videos, {
        onEnter: function onEnter(item, html) {
          _this5.getFileUrl(item, function(json, json_call) {
            if (json && json.url) {
              var playlist = [];
              var first = _this5.toPlayElement(item);
              first.url = json.url;
              first.headers = json_call.headers || json.headers;
              first.quality = json_call.quality || item.qualitys;
			  first.segments = json_call.segments || item.segments;
              first.hls_manifest_timeout = json_call.hls_manifest_timeout || json.hls_manifest_timeout;
              first.subtitles = json.subtitles;
			  first.subtitles_call = json_call.subtitles_call || json.subtitles_call;
			  if (json.vast && json.vast.url) {
                first.vast_url = json.vast.url;
                first.vast_msg = json.vast.msg;
                first.vast_region = json.vast.region;
                first.vast_platform = json.vast.platform;
                first.vast_screen = json.vast.screen;
			  }
              _this5.orUrlReserve(first);
              _this5.setDefaultQuality(first);
              if (item.season) {
                videos.forEach(function(elem) {
                  var cell = _this5.toPlayElement(elem);
                  if (elem == item) cell.url = json.url;
                  else {
                    if (elem.method == 'call') {
                      if (Lampa.Storage.field('player') !== 'inner') {
                        cell.url = elem.stream;
						delete cell.quality;
                      } else {
                        cell.url = function(call) {
                          _this5.getFileUrl(elem, function(stream, stream_json) {
                            if (stream.url) {
                              cell.url = stream.url;
                              cell.quality = stream_json.quality || elem.qualitys;
							  cell.segments = stream_json.segments || elem.segments;
                              cell.subtitles = stream.subtitles;
                              _this5.orUrlReserve(cell);
                              _this5.setDefaultQuality(cell);
                              elem.mark();
                            } else {
                              cell.url = '';
                              Lampa.Noty.show(Lampa.Lang.translate('lampac_nolink'));
                            }
                            call();
                          }, function() {
                            cell.url = '';
                            call();
                          });
                        };
                      }
                    } else {
                      cell.url = elem.url;
                    }
                  }
                  _this5.orUrlReserve(cell);
                  _this5.setDefaultQuality(cell);
                  playlist.push(cell);
                }); //Lampa.Player.playlist(playlist) 
              } else {
                playlist.push(first);
              }
              if (playlist.length > 1) first.playlist = playlist;
              if (first.url) {
                var element = first;
				element.isonline = true;
                
                Lampa.Player.play(element);
                Lampa.Player.playlist(playlist);
				if(element.subtitles_call) _this5.loadSubtitles(element.subtitles_call)
                item.mark();
                _this5.updateBalanser(balanser);
              } else {
                Lampa.Noty.show(Lampa.Lang.translate('lampac_nolink'));
              }
            } else Lampa.Noty.show(Lampa.Lang.translate('lampac_nolink'));
          }, true);
        },
        onContextMenu: function onContextMenu(item, html, data, call) {
          _this5.getFileUrl(item, function(stream) {
            call({
              file: stream.url,
              quality: item.qualitys
            });
          }, true);
        }
      });
      this.filter({
        season: filter_find.season.map(function(s) {
          return s.title;
        }),
        voice: filter_find.voice.map(function(b) {
          return b.title;
        })
      }, this.getChoice());
    };
	this.loadSubtitles = function(link){
		network.silent(account(link), function(subs){
			Lampa.Player.subtitles(subs)
		}, function() {},false, {
            headers: addHeaders()
		  })
	}
    this.parse = function(str) {
      var json = Lampa.Arrays.decodeJson(str, {});
      if (Lampa.Arrays.isObject(str) && str.rch) json = str;
      if (json.rch) return this.rch(json);
      try {
        var items = this.parseJsonDate(str, '.videos__item');
        var buttons = this.parseJsonDate(str, '.videos__button');
        if (items.length == 1 && items[0].method == 'link' && !items[0].similar) {
          filter_find.season = items.map(function(s) {
            return {
              title: s.text,
              url: s.url
            };
          });
          this.replaceChoice({
            season: 0
          });
          this.request(items[0].url);
        } else {
          this.activity.loader(false);
          var videos = items.filter(function(v) {
            return v.method == 'play' || v.method == 'call';
          });
          var similar = items.filter(function(v) {
            return v.similar;
          });
          if (videos.length) {
            if (buttons.length) {
              filter_find.voice = buttons.map(function(b) {
                return {
                  title: b.text,
                  url: b.url
                };
              });
              var select_voice_url = this.getChoice(balanser).voice_url;
              var select_voice_name = this.getChoice(balanser).voice_name;
              var find_voice_url = buttons.find(function(v) {
                return v.url == select_voice_url;
              });
              var find_voice_name = buttons.find(function(v) {
                return v.text == select_voice_name;
              });
              var find_voice_active = buttons.find(function(v) {
                return v.active;
              }); ////console.log('b',buttons)
              ////console.log('u',find_voice_url)
              ////console.log('n',find_voice_name)
              ////console.log('a',find_voice_active)
              if (find_voice_url && !find_voice_url.active) {
                //console.log('Lampac', 'go to voice', find_voice_url);
                this.replaceChoice({
                  voice: buttons.indexOf(find_voice_url),
                  voice_name: find_voice_url.text
                });
                this.request(find_voice_url.url);
              } else if (find_voice_name && !find_voice_name.active) {
                //console.log('Lampac', 'go to voice', find_voice_name);
                this.replaceChoice({
                  voice: buttons.indexOf(find_voice_name),
                  voice_name: find_voice_name.text
                });
                this.request(find_voice_name.url);
              } else {
                if (find_voice_active) {
                  this.replaceChoice({
                    voice: buttons.indexOf(find_voice_active),
                    voice_name: find_voice_active.text
                  });
                }
                this.display(videos);
              }
            } else {
              this.replaceChoice({
                voice: 0,
                voice_url: '',
                voice_name: ''
              });
              this.display(videos);
            }
          } else if (items.length) {
            if (similar.length) {
              this.similars(similar);
              this.activity.loader(false);
            } else { //this.activity.loader(true)
              filter_find.season = items.map(function(s) {
                return {
                  title: s.text,
                  url: s.url
                };
              });
              var select_season = this.getChoice(balanser).season;
              var season = filter_find.season[select_season];
              if (!season) season = filter_find.season[0];
              //console.log('Lampac', 'go to season', season);
              this.request(season.url);
            }
          } else {
            this.doesNotAnswer(json);
          }
        }
      } catch (e) {
        //console.log('Lampac', 'error', e.stack);
        this.doesNotAnswer(e);
      }
    };
    this.similars = function(json) {
      var _this6 = this;
      scroll.clear();
      json.forEach(function(elem) {
        elem.title = elem.text;
        elem.info = '';
        var info = [];
        var year = ((elem.start_date || elem.year || object.movie.release_date || object.movie.first_air_date || '') + '').slice(0, 4);
        if (year) info.push(year);
        if (elem.details) info.push(elem.details);
        var name = elem.title || elem.text;
        elem.title = name;
        elem.time = elem.time || '';
        elem.info = info.join('<span class="online-prestige-split">●</span>');
        var item = Lampa.Template.get('lampac_prestige_folder', elem);
		if (elem.img) {
		  var image = $('<img style="height: 7em; width: 7em; border-radius: 0.3em;"/>');
		  item.find('.online-prestige__folder').empty().append(image);

		  if (elem.img !== undefined) {
		    if (elem.img.charAt(0) === '/')
		      elem.img = Defined.localhost + elem.img.substring(1);
		    if (elem.img.indexOf('/proxyimg') !== -1)
		      elem.img = account(elem.img);
		  }

		  Lampa.Utils.imgLoad(image, elem.img);
		}
        item.on('hover:enter', function() {
          _this6.reset();
          _this6.request(elem.url);
        }).on('hover:focus', function(e) {
          last = e.target;
          scroll.update($(e.target), true);
        });
        scroll.append(item);
      });
	  this.filter({
        season: filter_find.season.map(function(s) {
          return s.title;
        }),
        voice: filter_find.voice.map(function(b) {
          return b.title;
        })
      }, this.getChoice());
      Lampa.Controller.enable('content');
    };
    this.getChoice = function(for_balanser) {
      var data = Lampa.Storage.cache('online_choice_' + (for_balanser || balanser), 3000, {});
      var save = data[object.movie.id] || {};
      Lampa.Arrays.extend(save, {
        season: 0,
        voice: 0,
        voice_name: '',
        voice_id: 0,
        episodes_view: {},
        movie_view: ''
      });
      return save;
    };
    this.saveChoice = function(choice, for_balanser) {
      var data = Lampa.Storage.cache('online_choice_' + (for_balanser || balanser), 3000, {});
      data[object.movie.id] = choice;
      Lampa.Storage.set('online_choice_' + (for_balanser || balanser), data);
      this.updateBalanser(for_balanser || balanser);
    };
    this.replaceChoice = function(choice, for_balanser) {
      var to = this.getChoice(for_balanser);
      Lampa.Arrays.extend(to, choice, true);
      this.saveChoice(to, for_balanser);
    };
    this.clearImages = function() {
      images.forEach(function(img) {
        img.onerror = function() {};
        img.onload = function() {};
        img.src = '';
      });
      images = [];
    };
    /**
     * Очистить список файлов
     */
    this.reset = function() {
      last = false;
      clearInterval(balanser_timer);
      network.clear();
      this.clearImages();
      scroll.render().find('.empty').remove();
      scroll.clear();
      scroll.reset();
      scroll.body().append(Lampa.Template.get('lampac_content_loading'));
    };
    /**
     * Загрузка
     */
    this.loading = function(status) {
      if (status) this.activity.loader(true);
      else {
        this.activity.loader(false);
        this.activity.toggle();
      }
    };
    /**
     * Построить фильтр
     */
    this.filter = function(filter_items, choice) {
      var _this7 = this;
      var select = [];
      var add = function add(type, title) {
        var need = _this7.getChoice();
        var items = filter_items[type];
        var subitems = [];
        var value = need[type];
        items.forEach(function(name, i) {
          subitems.push({
            title: name,
            selected: value == i,
            index: i
          });
        });
        select.push({
          title: title,
          subtitle: items[value],
          items: subitems,
          stype: type
        });
      };
      filter_items.source = filter_sources;
      this.saveChoice(choice);
      if (filter_items.season && filter_items.season.length) add('season', Lampa.Lang.translate('torrent_serial_season'));
      if (filter_items.voice && filter_items.voice.length) add('voice', Lampa.Lang.translate('torrent_parser_voice'));
      select.push({
        title: Lampa.Lang.translate('torrent_parser_reset'),
        reset: true
      });
							  
																													  
																														  
      filter.set('filter', select);
      filter.set('sort', filter_sources.map(function(e) {
        return {
          title: sources[e].name,
          source: e,
          selected: e == balanser,
          ghost: !sources[e].show
        };
      }));
      this.selected(filter_items);
    };
    /**
     * Показать что выбрано в фильтре
     */
    this.selected = function(filter_items) {
      var need = this.getChoice(),
        select = [];
      for (var i in need) {
        if (filter_items[i] && filter_items[i].length) {
          if (i == 'voice') {
            select.push(filter_translate[i] + ': ' + filter_items[i][need[i]]);
          } else if (i !== 'source') {
            if (filter_items.season.length >= 1) {
              select.push(filter_translate.season + ': ' + filter_items[i][need[i]]);
            }
          }
        }
      }
      filter.chosen('filter', select);
      filter.chosen('sort', [sources[balanser].name]);
    };
    this.getEpisodes = function(season, call) {
      var episodes = [];
	  var tmdb_id = object.movie.id;
	  if (['cub', 'tmdb'].indexOf(object.movie.source || 'tmdb') == -1) 
        tmdb_id = object.movie.tmdb_id;
      if (typeof tmdb_id == 'number' && object.movie.name) {
		  Lampa.Api.sources.tmdb.get('tv/' + tmdb_id + '/season/' + season, {}, function(data){
			  episodes = data.episodes || [];
			  
			  call(episodes);
		  }, function(){
			  call(episodes);
		  })
      } else call(episodes);
    };
    this.watched = function(set) {
      var file_id = Lampa.Utils.hash(object.movie.number_of_seasons ? object.movie.original_name : object.movie.original_title);
      var watched = Lampa.Storage.cache('online_watched_last', 5000, {});
      if (set) {
        if (!watched[file_id]) watched[file_id] = {};
        Lampa.Arrays.extend(watched[file_id], set, true);
        Lampa.Storage.set('online_watched_last', watched);
        this.updateWatched();
      } else {
        return watched[file_id];
      }
    };
    this.updateWatched = function() {
      var watched = this.watched();
      var body = scroll.body().find('.online-prestige-watched .online-prestige-watched__body').empty();
      if (watched) {
        var line = [];
        if (watched.balanser_name) line.push(watched.balanser_name);
        if (watched.voice_name) line.push(watched.voice_name);
        if (watched.season) line.push(Lampa.Lang.translate('torrent_serial_season') + ' ' + watched.season);
        if (watched.episode) line.push(Lampa.Lang.translate('torrent_serial_episode') + ' ' + watched.episode);
        line.forEach(function(n) {
          body.append('<span>' + n + '</span>');
        });
      } else body.append('<span>' + Lampa.Lang.translate('lampac_no_watch_history') + '</span>');
    };
    /**
     * Отрисовка файлов
     */
    this.draw = function(items) {
      var _this8 = this;
      var params = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
      if (!items.length) return this.empty();
      scroll.clear();
      if(!object.balanser)scroll.append(Lampa.Template.get('lampac_prestige_watched', {}));
      this.updateWatched();
      this.getEpisodes(items[0].season, function(episodes) {
        var viewed = Lampa.Storage.cache('online_view', 5000, []);
        var serial = object.movie.name ? true : false;
        var choice = _this8.getChoice();
        var fully = window.innerWidth > 480;
        var scroll_to_element = false;
        var scroll_to_mark = false;
        items.forEach(function(element, index) {
          var episode = serial && episodes.length && !params.similars ? episodes.find(function(e) {
            return e.episode_number == element.episode;
          }) : false;
          var episode_num = element.episode || index + 1;
          var episode_last = choice.episodes_view[element.season];
          var voice_name = choice.voice_name || (filter_find.voice[0] ? filter_find.voice[0].title : false) || element.voice_name || (serial ? 'Неизвестно' : element.text) || 'Неизвестно';
          if (element.quality) {
            element.qualitys = element.quality;
            element.quality = Lampa.Arrays.getKeys(element.quality)[0];
          }
          Lampa.Arrays.extend(element, {
            voice_name: voice_name,
            info: voice_name.length > 60 ? voice_name.substr(0, 60) + '...' : voice_name,
            quality: '',
            time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true)
          });
          var hash_timeline = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title].join('') : object.movie.original_title);
          var hash_behold = Lampa.Utils.hash(element.season ? [element.season, element.season > 10 ? ':' : '', element.episode, object.movie.original_title, element.voice_name].join('') : object.movie.original_title + element.voice_name);
          var data = {
            hash_timeline: hash_timeline,
            hash_behold: hash_behold
          };
          var info = [];
          if (element.season) {
            element.translate_episode_end = _this8.getLastEpisode(items);
            element.translate_voice = element.voice_name;
          }
          if (element.text && !episode) element.title = element.text;
          element.timeline = Lampa.Timeline.view(hash_timeline);
          if (episode) {
            element.title = episode.name;
            if (element.info.length < 30 && episode.vote_average) info.push(Lampa.Template.get('lampac_prestige_rate', {
              rate: parseFloat(episode.vote_average + '').toFixed(1)
            }, true));
            if (episode.air_date && fully) info.push(Lampa.Utils.parseTime(episode.air_date).full);
          } else if (object.movie.release_date && fully) {
            info.push(Lampa.Utils.parseTime(object.movie.release_date).full);
          }
          if (!serial && object.movie.tagline && element.info.length < 30) info.push(object.movie.tagline);
          if (element.info) info.push(element.info);
          if (info.length) element.info = info.map(function(i) {
            return '<span>' + i + '</span>';
          }).join('<span class="online-prestige-split">●</span>');
          var html = Lampa.Template.get('lampac_prestige_full', element);
          var loader = html.find('.online-prestige__loader');
          var image = html.find('.online-prestige__img');
		  if(object.balanser) image.hide();
          if (!serial) {
            if (choice.movie_view == hash_behold) scroll_to_element = html;
          } else if (typeof episode_last !== 'undefined' && episode_last == episode_num) {
            scroll_to_element = html;
          }
          if (serial && !episode) {
            image.append('<div class="online-prestige__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>');
            loader.remove();
          }
		  else if (!serial && object.movie.backdrop_path == 'undefined') loader.remove();
          else {
            var img = html.find('img')[0];
            img.onerror = function() {
              img.src = './img/img_broken.svg';
            };
            img.onload = function() {
              image.addClass('online-prestige__img--loaded');
              loader.remove();
              if (serial) image.append('<div class="online-prestige__episode-number">' + ('0' + (element.episode || index + 1)).slice(-2) + '</div>');
            };
            img.src = Lampa.TMDB.image('t/p/w300' + (episode ? episode.still_path : object.movie.backdrop_path));
            images.push(img);
			element.thumbnail = img.src
          }
          html.find('.online-prestige__timeline').append(Lampa.Timeline.render(element.timeline));
          if (viewed.indexOf(hash_behold) !== -1) {
            scroll_to_mark = html;
            html.find('.online-prestige__img').append('<div class="online-prestige__viewed">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
          }
          element.mark = function() {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold) == -1) {
              viewed.push(hash_behold);
              Lampa.Storage.set('online_view', viewed);
              if (html.find('.online-prestige__viewed').length == 0) {
                html.find('.online-prestige__img').append('<div class="online-prestige__viewed">' + Lampa.Template.get('icon_viewed', {}, true) + '</div>');
              }
            }
            choice = _this8.getChoice();
            if (!serial) {
              choice.movie_view = hash_behold;
            } else {
              choice.episodes_view[element.season] = episode_num;
            }
            _this8.saveChoice(choice);
            var voice_name_text = choice.voice_name || element.voice_name || element.title;
            if (voice_name_text.length > 30) voice_name_text = voice_name_text.slice(0, 30) + '...';
            _this8.watched({
              balanser: balanser,
              balanser_name: Lampa.Utils.capitalizeFirstLetter(sources[balanser] ? sources[balanser].name.split(' ')[0] : balanser),
              voice_id: choice.voice_id,
              voice_name: voice_name_text,
              episode: element.episode,
              season: element.season
            });
          };
          element.unmark = function() {
            viewed = Lampa.Storage.cache('online_view', 5000, []);
            if (viewed.indexOf(hash_behold) !== -1) {
              Lampa.Arrays.remove(viewed, hash_behold);
              Lampa.Storage.set('online_view', viewed);
              Lampa.Storage.remove('online_view', hash_behold);
              html.find('.online-prestige__viewed').remove();
            }
          };
          element.timeclear = function() {
            element.timeline.percent = 0;
            element.timeline.time = 0;
            element.timeline.duration = 0;
            Lampa.Timeline.update(element.timeline);
          };
          html.on('hover:enter', function() {
            if (object.movie.id) Lampa.Favorite.add('history', object.movie, 100);
            if (params.onEnter) params.onEnter(element, html, data);
          }).on('hover:focus', function(e) {
            last = e.target;
            if (params.onFocus) params.onFocus(element, html, data);
            scroll.update($(e.target), true);
          });
          if (params.onRender) params.onRender(element, html, data);
          _this8.contextMenu({
            html: html,
            element: element,
            onFile: function onFile(call) {
              if (params.onContextMenu) params.onContextMenu(element, html, data, call);
            },
            onClearAllMark: function onClearAllMark() {
              items.forEach(function(elem) {
                elem.unmark();
              });
            },
            onClearAllTime: function onClearAllTime() {
              items.forEach(function(elem) {
                elem.timeclear();
              });
            }
          });
          scroll.append(html);
        });
        if (serial && episodes.length > items.length && !params.similars) {
          var left = episodes.slice(items.length);
          left.forEach(function(episode) {
            var info = [];
            if (episode.vote_average) info.push(Lampa.Template.get('lampac_prestige_rate', {
              rate: parseFloat(episode.vote_average + '').toFixed(1)
            }, true));
            if (episode.air_date) info.push(Lampa.Utils.parseTime(episode.air_date).full);
            var air = new Date((episode.air_date + '').replace(/-/g, '/'));
            var now = Date.now();
            var day = Math.round((air.getTime() - now) / (24 * 60 * 60 * 1000));
            var txt = Lampa.Lang.translate('full_episode_days_left') + ': ' + day;
            var html = Lampa.Template.get('lampac_prestige_full', {
              time: Lampa.Utils.secondsToTime((episode ? episode.runtime : object.movie.runtime) * 60, true),
              info: info.length ? info.map(function(i) {
                return '<span>' + i + '</span>';
              }).join('<span class="online-prestige-split">●</span>') : '',
              title: episode.name,
              quality: day > 0 ? txt : ''
            });
            var loader = html.find('.online-prestige__loader');
            var image = html.find('.online-prestige__img');
            var season = items[0] ? items[0].season : 1;
            html.find('.online-prestige__timeline').append(Lampa.Timeline.render(Lampa.Timeline.view(Lampa.Utils.hash([season, episode.episode_number, object.movie.original_title].join('')))));
            var img = html.find('img')[0];
            if (episode.still_path) {
              img.onerror = function() {
                img.src = './img/img_broken.svg';
              };
              img.onload = function() {
                image.addClass('online-prestige__img--loaded');
                loader.remove();
                image.append('<div class="online-prestige__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>');
              };
              img.src = Lampa.TMDB.image('t/p/w300' + episode.still_path);
              images.push(img);
            } else {
              loader.remove();
              image.append('<div class="online-prestige__episode-number">' + ('0' + episode.episode_number).slice(-2) + '</div>');
            }
            html.on('hover:focus', function(e) {
              last = e.target;
              scroll.update($(e.target), true);
            });
            html.css('opacity', '0.5');
            scroll.append(html);
          });
        }
        if (scroll_to_element) {
          last = scroll_to_element[0];
        } else if (scroll_to_mark) {
          last = scroll_to_mark[0];
        }
        Lampa.Controller.enable('content');
      });
    };
    /**
     * Меню
     */
    this.contextMenu = function(params) {
      params.html.on('hover:long', function() {
        function show(extra) {
          var enabled = Lampa.Controller.enabled().name;
          var menu = [];
          if (Lampa.Platform.is('webos')) {
            menu.push({
              title: Lampa.Lang.translate('player_lauch') + ' - Webos',
              player: 'webos'
            });
          }
          if (Lampa.Platform.is('android')) {
            menu.push({
              title: Lampa.Lang.translate('player_lauch') + ' - Android',
              player: 'android'
            });
          }
          menu.push({
            title: Lampa.Lang.translate('player_lauch') + ' - Lampa',
            player: 'lampa'
          });
          menu.push({
            title: Lampa.Lang.translate('lampac_video'),
            separator: true
          });
          menu.push({
            title: Lampa.Lang.translate('torrent_parser_label_title'),
            mark: true
          });
          menu.push({
            title: Lampa.Lang.translate('torrent_parser_label_cancel_title'),
            unmark: true
          });
          menu.push({
            title: Lampa.Lang.translate('time_reset'),
            timeclear: true
          });
          if (extra) {
            menu.push({
              title: Lampa.Lang.translate('copy_link'),
              copylink: true
            });
          }
          if (window.lampac_online_context_menu)
            window.lampac_online_context_menu.push(menu, extra, params);
          menu.push({
            title: Lampa.Lang.translate('more'),
            separator: true
          });
          if (Lampa.Account.logged() && params.element && typeof params.element.season !== 'undefined' && params.element.translate_voice) {
            menu.push({
              title: Lampa.Lang.translate('lampac_voice_subscribe'),
              subscribe: true
            });
          }
          menu.push({
            title: Lampa.Lang.translate('lampac_clear_all_marks'),
            clearallmark: true
          });
          menu.push({
            title: Lampa.Lang.translate('lampac_clear_all_timecodes'),
            timeclearall: true
          });
          Lampa.Select.show({
            title: Lampa.Lang.translate('title_action'),
            items: menu,
            onBack: function onBack() {
              Lampa.Controller.toggle(enabled);
            },
            onSelect: function onSelect(a) {
              if (a.mark) params.element.mark();
              if (a.unmark) params.element.unmark();
              if (a.timeclear) params.element.timeclear();
              if (a.clearallmark) params.onClearAllMark();
              if (a.timeclearall) params.onClearAllTime();
              if (window.lampac_online_context_menu)
                window.lampac_online_context_menu.onSelect(a, params);
              Lampa.Controller.toggle(enabled);
              if (a.player) {
                Lampa.Player.runas(a.player);
                params.html.trigger('hover:enter');
              }
              if (a.copylink) {
                if (extra.quality) {
                  var qual = [];
                  for (var i in extra.quality) {
                    qual.push({
                      title: i,
                      file: extra.quality[i]
                    });
                  }
                  Lampa.Select.show({
                    title: Lampa.Lang.translate('settings_server_links'),
                    items: qual,
                    onBack: function onBack() {
                      Lampa.Controller.toggle(enabled);
                    },
                    onSelect: function onSelect(b) {
                      Lampa.Utils.copyTextToClipboard(b.file, function() {
                        Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
                      }, function() {
                        Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
                      });
                    }
                  });
                } else {
                  Lampa.Utils.copyTextToClipboard(extra.file, function() {
                    Lampa.Noty.show(Lampa.Lang.translate('copy_secuses'));
                  }, function() {
                    Lampa.Noty.show(Lampa.Lang.translate('copy_error'));
                  });
                }
              }
              if (a.subscribe) {
                Lampa.Account.subscribeToTranslation({
                  card: object.movie,
                  season: params.element.season,
                  episode: params.element.translate_episode_end,
                  voice: params.element.translate_voice
                }, function() {
                  Lampa.Noty.show(Lampa.Lang.translate('lampac_voice_success'));
                }, function() {
                  Lampa.Noty.show(Lampa.Lang.translate('lampac_voice_error'));
                });
              }
            }
          });
        }
        params.onFile(show);
      }).on('hover:focus', function() {
        if (Lampa.Helper) Lampa.Helper.show('online_file', Lampa.Lang.translate('helper_online_file'), params.html);
      });
    };
    /**
     * Показать пустой результат
     */
    this.empty = function() {
      var html = Lampa.Template.get('lampac_does_not_answer', {});
      html.find('.online-empty__buttons').remove();
      html.find('.online-empty__title').text(Lampa.Lang.translate('empty_title_two'));
      html.find('.online-empty__time').text(Lampa.Lang.translate('empty_text'));
      scroll.clear();
      scroll.append(html);
      this.loading(false);
    };
    this.noConnectToServer = function(er) {
      var html = Lampa.Template.get('lampac_does_not_answer', {});
      html.find('.online-empty__buttons').remove();
      html.find('.online-empty__title').text(Lampa.Lang.translate('title_error'));
      html.find('.online-empty__time').text(er && er.accsdb ? er.msg : Lampa.Lang.translate('lampac_does_not_answer_text').replace('{balanser}', balanser[balanser].name));
      scroll.clear();
      scroll.append(html);
      this.loading(false);
    };
    this.doesNotAnswer = function(er) {
      var _this9 = this;
      this.reset();
      var html = Lampa.Template.get('lampac_does_not_answer', {
        balanser: balanser
      });
      if(er && er.accsdb) html.find('.online-empty__title').html(er.msg);
	  
      var tic = er && er.accsdb ? 10 : 5;
      html.find('.cancel').on('hover:enter', function() {
        clearInterval(balanser_timer);
      });
      html.find('.change').on('hover:enter', function() {
        clearInterval(balanser_timer);
        filter.render().find('.filter--sort').trigger('hover:enter');
      });
      scroll.clear();
      scroll.append(html);
      this.loading(false);
      balanser_timer = setInterval(function() {
        tic--;
        html.find('.timeout').text(tic);
        if (tic == 0) {
          clearInterval(balanser_timer);
          var keys = Lampa.Arrays.getKeys(sources);
          var indx = keys.indexOf(balanser);
          var next = keys[indx + 1];
          if (!next) next = keys[0];
          balanser = next;
          if (Lampa.Activity.active().activity == _this9.activity) _this9.changeBalanser(balanser);
        }
      }, 1000);
    };
    this.getLastEpisode = function(items) {
      var last_episode = 0;
      items.forEach(function(e) {
        if (typeof e.episode !== 'undefined') last_episode = Math.max(last_episode, parseInt(e.episode));
      });
      return last_episode;
    };
    /**
     * Начать навигацию по файлам
     */
    this.start = function() {
      if (Lampa.Activity.active().activity !== this.activity) return;
      if (!initialized) {
        initialized = true;
        this.initialize();
      }
      Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(object.movie));
      Lampa.Controller.add('content', {
        toggle: function toggle() {
          Lampa.Controller.collectionSet(scroll.render(), files.render());
          Lampa.Controller.collectionFocus(last || false, scroll.render());
        },
        gone: function gone() {
          clearTimeout(balanser_timer);
        },
        up: function up() {
          if (Navigator.canmove('up')) {
            Navigator.move('up');
          } else Lampa.Controller.toggle('head');
        },
        down: function down() {
          Navigator.move('down');
        },
        right: function right() {
          if (Navigator.canmove('right')) Navigator.move('right');
          else filter.show(Lampa.Lang.translate('title_filter'), 'filter');
        },
        left: function left() {
          if (Navigator.canmove('left')) Navigator.move('left');
          else Lampa.Controller.toggle('menu');
        },
        back: this.back.bind(this)
      });
      Lampa.Controller.toggle('content');
    };
    this.render = function() {
      return files.render();
    };
    this.back = function() {
      Lampa.Activity.backward();
    };
    this.pause = function() {};
    this.stop = function() {};
    this.destroy = function() {
      network.clear();
      this.clearImages();
      files.destroy();
      scroll.destroy();
      clearInterval(balanser_timer);
      clearTimeout(life_wait_timer);
    };
  }
  
  function addSourceSearch(spiderName, spiderUri) {
    var network = new Lampa.Reguest();

    var source = {
      title: spiderName,
      search: function(params, oncomplite) {
        function searchComplite(links) {
          var keys = Lampa.Arrays.getKeys(links);

          if (keys.length) {
            var status = new Lampa.Status(keys.length);

            status.onComplite = function(result) {
              var rows = [];

              keys.forEach(function(name) {
                var line = result[name];

                if (line && line.data && line.type == 'similar') {
                  var cards = line.data.map(function(item) {
                    item.title = Lampa.Utils.capitalizeFirstLetter(item.title);
                    item.release_date = item.year || '0000';
                    item.balanser = spiderUri;
                    if (item.img !== undefined) {
                      if (item.img.charAt(0) === '/')
                        item.img = Defined.localhost + item.img.substring(1);
                      if (item.img.indexOf('/proxyimg') !== -1)
                        item.img = account(item.img);
                    }

                    return item;
                  })

                  rows.push({
                    title: name,
                    results: cards
                  })
                }
              })

              oncomplite(rows);
            }

            keys.forEach(function(name) {
              network.silent(account(links[name]), function(data) {
                status.append(name, data);
              }, function() {
                status.error();
              }, false, {
                  headers: addHeaders()
		  })
            })
          } else {
            oncomplite([]);
          }
        }

        network.silent(account(Defined.localhost + 'lite/' + spiderUri + '?title=' + params.query), function(json) {
          if (json.rch) {
            rchRun(json, function() {
              network.silent(account(Defined.localhost + 'lite/' + spiderUri + '?title=' + params.query), function(links) {
                searchComplite(links);
              }, function() {
                oncomplite([]);
              }, false, {
                  headers: addHeaders()
		  });
            });
          } else {
            searchComplite(json);
          }
        }, function() {
          oncomplite([]);
        }, false, {
            headers: addHeaders()
		  });
      },
      onCancel: function() {
        network.clear()
      },
      params: {
        lazy: true,
        align_left: true,
        card_events: {
          onMenu: function() {}
        }
      },
      onMore: function(params, close) {
        close();
      },
      onSelect: function(params, close) {
        close();

        Lampa.Activity.push({
          url: params.element.url,
          title: 'Lampac - ' + params.element.title,
          component: 'neurostream',
          movie: params.element,
          page: 1,
          search: params.element.title,
          clarification: true,
          balanser: params.element.balanser,
          noinfo: true
        });
      }
    }

    Lampa.Search.addSource(source)
  }

  function startPlugin() {
    window.neurostream_plugin = true;
    var manifst = {
      type: 'video',
      version: '1.0.0',
      name: 'NeuroStream',
      description: 'Plugin for online content',
      component: 'neurostream',
      onContextMenu: function onContextMenu(object) {
        return {
          name: Lampa.Lang.translate('lampac_watch'),
          description: ''
        };
      },
      onContextLauch: function onContextLauch(object) {
        resetTemplates();
        Lampa.Component.add('neurostream', component);
		
		var id = Lampa.Utils.hash(object.number_of_seasons ? object.original_name : object.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
        Lampa.Activity.push({
          url: '',
          title: Lampa.Lang.translate('title_online'),
          component: 'neurostream',
          search: all[id] ? all[id] : object.title,
          search_one: object.title,
          search_two: object.original_title,
          movie: object,
          page: 1,
		  clarification: all[id] ? true : false
        });
      }
    };
	
	
    Lampa.Manifest.plugins = manifst;
    Lampa.Lang.add({
      lampac_watch: { //
        ru: 'Skatīties online',
        en: 'Watch online',
        uk: 'Дивитися онлайн',
        zh: '在线观看'
      },
      lampac_video: { //
        ru: 'Video',
        en: 'Video',
        uk: 'Відео',
        zh: '视频'
      },
      lampac_no_watch_history: {
        ru: 'Nav skatīšanās vēstures',
        en: 'No browsing history',
        ua: 'Немає історії перегляду',
        zh: '没有浏览历史'
      },
      lampac_nolink: {
        ru: 'Neizdevās saņemt hipersaiti',
        uk: 'Неможливо отримати посилання',
        en: 'Failed to fetch link',
        zh: '获取链接失败'
      },
      lampac_balanser: { //
        ru: 'Resurss',
        uk: 'Джерело',
        en: 'Source',
        zh: '来源'
      },
      helper_online_file: { //
        ru: 'Turiet nospiestu "ОК" lai parādītu izvēlni',
        uk: 'Утримуйте клавішу "ОК" для виклику контекстного меню',
        en: 'Hold the "OK" key to bring up the context menu',
        zh: '按住“确定”键调出上下文菜单'
      },
      title_online: { //
        ru: 'Skatīties',
        uk: 'Онлайн',
        en: 'Online',
        zh: '在线的'
      },
      lampac_voice_subscribe: { //
        ru: 'Pierakstīties tulkojumam',
        uk: 'Підписатися на переклад',
        en: 'Subscribe to translation',
        zh: '订阅翻译'
      },
      lampac_voice_success: { //
        ru: 'Veiksmīga pierakstīšanās',
        uk: 'Ви успішно підписалися',
        en: 'You have successfully subscribed',
        zh: '您已成功订阅'
      },
      lampac_voice_error: { //
        ru: 'Notika kļūda',
        uk: 'Виникла помилка',
        en: 'An error has occurred',
        zh: '发生了错误'
      },
      lampac_clear_all_marks: { //
        ru: 'Notīrīt visas atzīmes',
        uk: 'Очистити всі мітки',
        en: 'Clear all labels',
        zh: '清除所有标签'
      },
      lampac_clear_all_timecodes: { //
        ru: 'Notīrīt taim-kodus',
        uk: 'Очистити всі тайм-коди',
        en: 'Clear all timecodes',
        zh: '清除所有时间代码'
      },
      lampac_change_balanser: { //
        ru: 'Mainīt balanseri',
        uk: 'Змінити балансер',
        en: 'Change balancer',
        zh: '更改平衡器'
      },
      lampac_balanser_dont_work: { //
        ru: 'Meklēšana nedeva rezultātu',
        uk: 'Пошук не дав результатів',
        en: 'Search did not return any results',
        zh: '搜索 未返回任何结果'
      },
      lampac_balanser_timeout: { //
        ru: 'Balanseris tiks pārslēgts automātiski pēc <span class="timeout">10</span> sekundēm.',
        uk: 'Джерело буде автоматично переключено через <span class="timeout">10</span> секунд.',
        en: 'The source will be switched automatically after <span class="timeout">10</span> seconds.',
        zh: '平衡器将在<span class="timeout">10</span>秒内自动切换。'
      },
      lampac_does_not_answer_text: {
        ru: 'Meklēšana nedeva rezultātu',
        uk: 'Пошук не дав результатів',
        en: 'Search did not return any results',
        zh: '搜索 未返回任何结果'
      }
    });
    Lampa.Template.add('lampac_css', "\n        <style>\n        @charset 'UTF-8';.online-prestige{position:relative;-webkit-border-radius:.3em;border-radius:.3em;background-color:rgba(0,0,0,0.3);display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}.online-prestige__body{padding:1.2em;line-height:1.3;-webkit-box-flex:1;-webkit-flex-grow:1;-moz-box-flex:1;-ms-flex-positive:1;flex-grow:1;position:relative}@media screen and (max-width:480px){.online-prestige__body{padding:.8em 1.2em}}.online-prestige__img{position:relative;width:13em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0;min-height:8.2em}.online-prestige__img>img{position:absolute;top:0;left:0;width:100%;height:100%;-o-object-fit:cover;object-fit:cover;-webkit-border-radius:.3em;border-radius:.3em;opacity:0;-webkit-transition:opacity .3s;-o-transition:opacity .3s;-moz-transition:opacity .3s;transition:opacity .3s}.online-prestige__img--loaded>img{opacity:1}@media screen and (max-width:480px){.online-prestige__img{width:7em;min-height:6em}}.online-prestige__folder{padding:1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}.online-prestige__folder>svg{width:4.4em !important;height:4.4em !important}.online-prestige__viewed{position:absolute;top:1em;left:1em;background:rgba(0,0,0,0.45);-webkit-border-radius:100%;border-radius:100%;padding:.25em;font-size:.76em}.online-prestige__viewed>svg{width:1.5em !important;height:1.5em !important}.online-prestige__episode-number{position:absolute;top:0;left:0;right:0;bottom:0;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-box-pack:center;-webkit-justify-content:center;-moz-box-pack:center;-ms-flex-pack:center;justify-content:center;font-size:2em}.online-prestige__loader{position:absolute;top:50%;left:50%;width:2em;height:2em;margin-left:-1em;margin-top:-1em;background:url(./img/loader.svg) no-repeat center center;-webkit-background-size:contain;-o-background-size:contain;background-size:contain}.online-prestige__head,.online-prestige__footer{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-pack:justify;-webkit-justify-content:space-between;-moz-box-pack:justify;-ms-flex-pack:justify;justify-content:space-between;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}.online-prestige__timeline{margin:.8em 0}.online-prestige__timeline>.time-line{display:block !important}.online-prestige__title{font-size:1.7em;overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}@media screen and (max-width:480px){.online-prestige__title{font-size:1.4em}}.online-prestige__time{padding-left:2em}.online-prestige__info{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}.online-prestige__info>*{overflow:hidden;-o-text-overflow:ellipsis;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:1;line-clamp:1;-webkit-box-orient:vertical}.online-prestige__quality{padding-left:1em;white-space:nowrap}.online-prestige__scan-file{position:absolute;bottom:0;left:0;right:0}.online-prestige__scan-file .broadcast__scan{margin:0}.online-prestige .online-prestige-split{font-size:.8em;margin:0 1em;-webkit-flex-shrink:0;-ms-flex-negative:0;flex-shrink:0}.online-prestige.focus::after{content:'';position:absolute;top:-0.6em;left:-0.6em;right:-0.6em;bottom:-0.6em;-webkit-border-radius:.7em;border-radius:.7em;border:solid .3em #fff;z-index:-1;pointer-events:none}.online-prestige+.online-prestige{margin-top:1.5em}.online-prestige--folder .online-prestige__footer{margin-top:.8em}.online-prestige-watched{padding:1em}.online-prestige-watched__icon>svg{width:1.5em;height:1.5em}.online-prestige-watched__body{padding-left:1em;padding-top:.1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-flex-wrap:wrap;-ms-flex-wrap:wrap;flex-wrap:wrap}.online-prestige-watched__body>span+span::before{content:' ● ';vertical-align:top;display:inline-block;margin:0 .5em}.online-prestige-rate{display:-webkit-inline-box;display:-webkit-inline-flex;display:-moz-inline-box;display:-ms-inline-flexbox;display:inline-flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center}.online-prestige-rate>svg{width:1.3em !important;height:1.3em !important}.online-prestige-rate>span{font-weight:600;font-size:1.1em;padding-left:.7em}.online-empty{line-height:1.4}.online-empty__title{font-size:1.8em;margin-bottom:.3em}.online-empty__time{font-size:1.2em;font-weight:300;margin-bottom:1.6em}.online-empty__buttons{display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex}.online-empty__buttons>*+*{margin-left:1em}.online-empty__button{background:rgba(0,0,0,0.3);font-size:1.2em;padding:.5em 1.2em;-webkit-border-radius:.2em;border-radius:.2em;margin-bottom:2.4em}.online-empty__button.focus{background:#fff;color:black}.online-empty__templates .online-empty-template:nth-child(2){opacity:.5}.online-empty__templates .online-empty-template:nth-child(3){opacity:.2}.online-empty-template{background-color:rgba(255,255,255,0.3);padding:1em;display:-webkit-box;display:-webkit-flex;display:-moz-box;display:-ms-flexbox;display:flex;-webkit-box-align:center;-webkit-align-items:center;-moz-box-align:center;-ms-flex-align:center;align-items:center;-webkit-border-radius:.3em;border-radius:.3em}.online-empty-template>*{background:rgba(0,0,0,0.3);-webkit-border-radius:.3em;border-radius:.3em}.online-empty-template__ico{width:4em;height:4em;margin-right:2.4em}.online-empty-template__body{height:1.7em;width:70%}.online-empty-template+.online-empty-template{margin-top:1em}\n        </style>\n    ");
    $('body').append(Lampa.Template.get('lampac_css', {}, true));

    function resetTemplates() {
      Lampa.Template.add('lampac_prestige_full', "<div class=\"online-prestige online-prestige--full selector\">\n            <div class=\"online-prestige__img\">\n                <img alt=\"\">\n                <div class=\"online-prestige__loader\"></div>\n            </div>\n            <div class=\"online-prestige__body\">\n                <div class=\"online-prestige__head\">\n                    <div class=\"online-prestige__title\">{title}</div>\n                    <div class=\"online-prestige__time\">{time}</div>\n                </div>\n\n                <div class=\"online-prestige__timeline\"></div>\n\n                <div class=\"online-prestige__footer\">\n                    <div class=\"online-prestige__info\">{info}</div>\n                    <div class=\"online-prestige__quality\">{quality}</div>\n                </div>\n            </div>\n        </div>");
      Lampa.Template.add('lampac_content_loading', "<div class=\"online-empty\">\n            <div class=\"broadcast__scan\"><div></div></div>\n\t\t\t\n            <div class=\"online-empty__templates\">\n                <div class=\"online-empty-template selector\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n            </div>\n        </div>");
      Lampa.Template.add('lampac_does_not_answer', "<div class=\"online-empty\">\n            <div class=\"online-empty__title\">\n                #{lampac_balanser_dont_work}\n            </div>\n            <div class=\"online-empty__time\">\n                #{lampac_balanser_timeout}\n            </div>\n            <div class=\"online-empty__buttons\">\n                <div class=\"online-empty__button selector cancel\">#{cancel}</div>\n                <div class=\"online-empty__button selector change\">#{lampac_change_balanser}</div>\n            </div>\n            <div class=\"online-empty__templates\">\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n                <div class=\"online-empty-template\">\n                    <div class=\"online-empty-template__ico\"></div>\n                    <div class=\"online-empty-template__body\"></div>\n                </div>\n            </div>\n        </div>");
      Lampa.Template.add('lampac_prestige_rate', "<div class=\"online-prestige-rate\">\n            <svg width=\"17\" height=\"16\" viewBox=\"0 0 17 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                <path d=\"M8.39409 0.192139L10.99 5.30994L16.7882 6.20387L12.5475 10.4277L13.5819 15.9311L8.39409 13.2425L3.20626 15.9311L4.24065 10.4277L0 6.20387L5.79819 5.30994L8.39409 0.192139Z\" fill=\"#fff\"></path>\n            </svg>\n            <span>{rate}</span>\n        </div>");
      Lampa.Template.add('lampac_prestige_folder', "<div class=\"online-prestige online-prestige--folder selector\">\n            <div class=\"online-prestige__folder\">\n                <svg viewBox=\"0 0 128 112\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                    <rect y=\"20\" width=\"128\" height=\"92\" rx=\"13\" fill=\"white\"></rect>\n                    <path d=\"M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z\" fill=\"white\" fill-opacity=\"0.23\"></path>\n                    <rect x=\"11\" y=\"8\" width=\"106\" height=\"76\" rx=\"13\" fill=\"white\" fill-opacity=\"0.51\"></rect>\n                </svg>\n            </div>\n            <div class=\"online-prestige__body\">\n                <div class=\"online-prestige__head\">\n                    <div class=\"online-prestige__title\">{title}</div>\n                    <div class=\"online-prestige__time\">{time}</div>\n                </div>\n\n                <div class=\"online-prestige__footer\">\n                    <div class=\"online-prestige__info\">{info}</div>\n                </div>\n            </div>\n        </div>");
      Lampa.Template.add('lampac_prestige_watched', "<div class=\"online-prestige online-prestige-watched selector\">\n            <div class=\"online-prestige-watched__icon\">\n                <svg width=\"21\" height=\"21\" viewBox=\"0 0 21 21\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\">\n                    <circle cx=\"10.5\" cy=\"10.5\" r=\"9\" stroke=\"currentColor\" stroke-width=\"3\"/>\n                    <path d=\"M14.8477 10.5628L8.20312 14.399L8.20313 6.72656L14.8477 10.5628Z\" fill=\"currentColor\"/>\n                </svg>\n            </div>\n            <div class=\"online-prestige-watched__body\">\n                \n            </div>\n        </div>");
    }
    var button = "<div class=\"full-start__button selector view--online lampac--button\" data-subtitle=\"".concat(manifst.name, " v").concat(manifst.version, "\">\n        <svg xmlns=\"http://www.w3.org/2000/svg\" version=\"1.1\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 392.697 392.697\" xml:space=\"preserve\">\n            <path d=\"M21.837,83.419l36.496,16.678L227.72,19.886c1.229-0.592,2.002-1.846,1.98-3.209c-0.021-1.365-0.834-2.592-2.082-3.145\n                L197.766,0.3c-0.903-0.4-1.933-0.4-2.837,0L21.873,77.036c-1.259,0.559-2.073,1.803-2.081,3.18\n                C19.784,81.593,20.584,82.847,21.837,83.419z\" fill=\"currentColor\"></path>\n            <path d=\"M185.689,177.261l-64.988-30.01v91.617c0,0.856-0.44,1.655-1.167,2.114c-0.406,0.257-0.869,0.386-1.333,0.386\n                c-0.368,0-0.736-0.082-1.079-0.244l-68.874-32.625c-0.869-0.416-1.421-1.293-1.421-2.256v-92.229L6.804,95.5\n                c-1.083-0.496-2.344-0.406-3.347,0.238c-1.002,0.645-1.608,1.754-1.608,2.944v208.744c0,1.371,0.799,2.615,2.045,3.185\n                l178.886,81.768c0.464,0.211,0.96,0.315,1.455,0.315c0.661,0,1.318-0.188,1.892-0.555c1.002-0.645,1.608-1.754,1.608-2.945\n                V180.445C187.735,179.076,186.936,177.831,185.689,177.261z\" fill=\"currentColor\"></path>\n            <path d=\"M389.24,95.74c-1.002-0.644-2.264-0.732-3.347-0.238l-178.876,81.76c-1.246,0.57-2.045,1.814-2.045,3.185v208.751\n                c0,1.191,0.606,2.302,1.608,2.945c0.572,0.367,1.23,0.555,1.892,0.555c0.495,0,0.991-0.104,1.455-0.315l178.876-81.768\n                c1.246-0.568,2.045-1.813,2.045-3.185V98.685C390.849,97.494,390.242,96.384,389.24,95.74z\" fill=\"currentColor\"></path>\n            <path d=\"M372.915,80.216c-0.009-1.377-0.823-2.621-2.082-3.18l-60.182-26.681c-0.938-0.418-2.013-0.399-2.938,0.045\n                l-173.755,82.992l60.933,29.117c0.462,0.211,0.958,0.316,1.455,0.316s0.993-0.105,1.455-0.316l173.066-79.092\n                C372.122,82.847,372.923,81.593,372.915,80.216z\" fill=\"currentColor\"></path>\n        </svg>\n\n        <span>#{title_online}</span>\n    </div>"); // нужна заглушка, а то при страте лампы говорит пусто
    Lampa.Component.add('neurostream', component); //то же самое
    resetTemplates();

    function addButton(e) {
      if (e.render.find('.lampac--button').length) return;
      var btn = $(Lampa.Lang.translate(button));
	  // //console.log(btn.clone().removeClass('focus').prop('outerHTML'))
      btn.on('hover:enter', function() {
        resetTemplates();
        Lampa.Component.add('neurostream', component);
		
		var id = Lampa.Utils.hash(e.movie.number_of_seasons ? e.movie.original_name : e.movie.original_title);
		var all = Lampa.Storage.get('clarification_search','{}');
		
        Lampa.Activity.push({
          url: '',
          title: Lampa.Lang.translate('title_online'),
          component: 'neurostream',
          search: all[id] ? all[id] : e.movie.title,
          search_one: e.movie.title,
          search_two: e.movie.original_title,
          movie: e.movie,
          page: 1,
		  clarification: all[id] ? true : false
        });
      });
      e.render.after(btn);
    }
    Lampa.Listener.follow('full', function(e) {
      if (e.type == 'complite') {
        addButton({
          render: e.object.activity.render().find('.view--torrent'),
          movie: e.data.movie
        });
      }
    });
    try {
      if (Lampa.Activity.active().component == 'full') {
        addButton({
          render: Lampa.Activity.active().activity.render().find('.view--torrent'),
          movie: Lampa.Activity.active().card
        });
      }
    } catch (e) {}
    if (Lampa.Manifest.app_digital >= 177) {
        var balansers_sync = ["neurostream", "filmix", 'filmixtv', "fxapi", "rezka", "rhsprem", "lumex", "videodb", "collaps", "collaps-dash", "hdvb", "zetflix", "kodik", "ashdi", "kinoukr", "kinotochka", "remux", "iframevideo", "cdnmovies", "anilibria", "animedia", "animego", "animevost", "animebesst", "redheadsound", "alloha", "animelib", "moonanime", "kinopub", "vibix", "vdbmovies", "fancdn", "cdnvideohub", "vokino", "rc/filmix", "rc/fxapi", "rc/rhs", "vcdn", "videocdn", "mirage", "hydraflix", "videasy", "vidsrc", "movpi", "vidlink", "twoembed", "autoembed", "smashystream", "autoembed", "rgshows", "pidtor", "videoseed", "iptvonline", "veoveo", "kinoflix"];
      balansers_sync.forEach(function(name) {
        Lampa.Storage.sync('online_choice_' + name, 'object_object');
      });
      Lampa.Storage.sync('online_watched_last', 'object_object');
    }
  }
  if (!window.neurostream_plugin) startPlugin();

})();