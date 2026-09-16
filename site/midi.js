/** Explicitly armed, monophonic output with conservative Disklavier defaults. */
import {clamp} from './core.js';

export class SoundEngine {
  constructor(log=()=>{}) {
    this.log=log; this.armed=false; this.output=null; this.ccOutput=null;
    this.access=null; this.channel=0; this.active=null; this.lastOn=-Infinity;
    this.audio=null; this.generation=0; this.preview=true; this.onState=()=>{};
  }
  async connect() {
    if(!navigator.requestMIDIAccess) throw new Error('Web MIDI is unavailable. Use desktop Chrome/Edge, or browser preview.');
    this.access=await navigator.requestMIDIAccess({sysex:false});
    this.access.onstatechange=()=>{
      if(this.output && this.output.state==='disconnected') {
        this.panic('MIDI disconnected'); this.output=null;
      }
      if(this.ccOutput && this.ccOutput.state==='disconnected') this.ccOutput=null;
      this.onState();
    };
    return [...this.access.outputs.values()];
  }
  outputs() { return this.access?[...this.access.outputs.values()]:[]; }
  select(id,channel=1) {
    this.panic('Output changed');
    this.output=this.outputs().find(p=>p.id===id)||null;
    this.channel=clamp(Math.round(channel)-1,0,15);
  }
  async arm() {
    const generation=++this.generation;
    if(this.preview) {
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!Context) throw new Error('Browser audio unavailable; select MIDI and disable preview.');
      if(!this.audio) this.audio=new Context();
      await this.audio.resume();
    }
    if(!this.output && !this.preview) throw new Error('Select an output or enable browser preview first.');
    if(generation!==this.generation) throw new Error('Arming cancelled; press Arm sound again.');
    this.armed=true; this.lastOn=-Infinity; this.onState();
  }
  send(output,bytes,when) {
    if(!output) return;
    output.send(bytes,when);
  }
  play(mapping,config,objectId) {
    if(![mapping.note,mapping.velocity,mapping.duration,config.channel].every(Number.isFinite)) throw new Error('Invalid MIDI mapping');
    const now=performance.now();
    if(!this.armed || now-this.lastOn<250) return false;
    this.release('new note');
    const note=clamp(Math.round(mapping.note),21,108);
    const velocity=clamp(Math.round(mapping.velocity),1,100);
    const duration=clamp(mapping.duration,100,1200);
    const ch=clamp(Math.round(config.channel)-1,0,15);
    this.channel=ch;
    const token={note,ch,output:this.output,timer:null,osc:null,gain:null,objectId};
    this.active=token;
    try {
      if(this.output) {
        this.send(this.output,[0x90+ch,note,velocity]);
        this.send(this.output,[0x80+ch,note,0],now+duration);
      }
      if(config.sendCC && this.ccOutput && mapping.color.value!==null) {
        this.send(this.ccOutput,[0xB0+ch,clamp(Math.round(config.colorCC),0,119),mapping.color.value]);
      }
      if(this.preview && this.audio) {
        const a=this.audio,osc=a.createOscillator(),gain=a.createGain(),filter=a.createBiquadFilter();
        osc.type='triangle'; osc.frequency.value=440*2**((note-69)/12);
        filter.type='lowpass'; filter.frequency.value=500+(mapping.color.value??64)*65;
        gain.gain.setValueAtTime(0,a.currentTime);
        gain.gain.linearRampToValueAtTime(.07*(velocity/100),a.currentTime+.015);
        gain.gain.exponentialRampToValueAtTime(.0001,a.currentTime+duration/1000);
        osc.connect(filter).connect(gain).connect(a.destination);
        osc.start(); osc.stop(a.currentTime+duration/1000+.03);
        osc.onended=()=>{osc.disconnect();filter.disconnect();gain.disconnect();};
        token.osc=osc; token.gain=gain;
      }
      this.lastOn=now;
      this.log({kind:'note_on',objectId,note,velocity,channel:ch+1,mapping,
        output:this.output?.name||'preview',colorOutput:config.sendCC?this.ccOutput?.name:null});
      token.timer=setTimeout(()=>{if(this.active===token) this.release('duration');},duration);
      return true;
    } catch(error) {
      this.panic('MIDI send failed'); throw error;
    }
  }
  release(reason='exit') {
    const a=this.active;
    if(!a) return;
    this.active=null; clearTimeout(a.timer);
    try { a.output?.clear(); this.send(a.output,[0x80+a.ch,a.note,0]); } catch {}
    if(a.osc && this.audio) {
      try {a.gain.gain.cancelScheduledValues(this.audio.currentTime);
        a.gain.gain.setTargetAtTime(0,this.audio.currentTime,.01);
        a.osc.stop(this.audio.currentTime+.04);} catch {}
    }
    this.log({kind:'note_off',objectId:a.objectId,note:a.note,channel:a.ch+1,reason});
  }
  panic(reason='Panic') {
    ++this.generation; this.armed=false; this.release(reason);
    try {
      this.output?.clear();
      for(const cc of [64,120,123]) this.send(this.output,[0xB0+this.channel,cc,0]);
    } catch {}
    this.log({kind:'stop',reason}); this.onState();
  }
}
