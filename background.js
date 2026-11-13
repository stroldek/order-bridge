// Stage 1 foundation only. No API polling or token capture is enabled yet.
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('order-bridge-poll',{periodInMinutes:2});chrome.storage.local.set({pollIntervalSeconds:120,connectionState:'disconnected'});});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='order-bridge-poll'){/* Stage 3: authenticated GOST polling will be implemented here. */}});
