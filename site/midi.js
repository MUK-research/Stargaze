/** Explicitly armed, monophonic output with conservative Disklavier defaults. */
import {clamp} from './core.js';

export function midiAccessError(error) {
  if(['NotAllowedError','SecurityError'].includes(error?.name))
    return 'MIDI permission denied. Allow MIDI for this site in the browser, then press Enable MIDI / Refresh outputs.';
  if(error?.name==='NotSupportedError')
    return 'This browser or operating system does not provide MIDI access. Use desktop Chrome/Edge or browser preview.';
  return `MIDI access failed: ${error?.message||String(error)}. Check the OS MIDI setup and refresh outputs.`;
}


export class SoundEngine {
  constructor(log=()=>{}) {
    this.log=log; this.armed=false; this.output=null; this.ccOutput=null;
    this.access=null; this.channel=0; this.active=null; this.lastOn=-Infinity;
    this.audio=null; this.generation=0; this.preview=true; this.onState=()=>{};
    this.outputId='';this.ccOutputId='';this.midiState='idle';this.midiError='';this.connecting=null;
  }
  async connect() {
    if(this.connecting) return this.connecting;
    this.connecting=this.refreshAccess();
    try {return await this.connecting;} finally {this.connecting=null;}
  }
  async refreshAccess() {
    this.panic('Refreshing MIDI outputs');
    this.midiError='';this.midiState='requesting';this.onState();
    try {
      if(globalThis.isSecureContext===false) throw new Error('Web MIDI needs localhost or HTTPS.');
      if(!globalThis.navigator?.requestMIDIAccess) {
        const e=new Error('Web MIDI unavailable');e.name='NotSupportedError';throw e;
      }
      // No device-name/manufacturer filtering. Request software synth exposure too
      // where supported. Virtual OS destinations (e.g. IAC) are ordinary ports.
      const access=await navigator.requestMIDIAccess({sysex:false,software:true});
      if(this.access) this.access.onstatechange=null;
      this.access=access;this.midiState='ready';
      access.onstatechange=()=>this.syncPorts();
      this.syncPorts();
      return this.outputs();
    } catch(error) {
      if(this.access) this.access.onstatechange=null;
      this.access=null;this.output=null;this.ccOutput=null;
      this.midiState=['NotAllowedError','SecurityError'].includes(error?.name)?'denied':'error';
      this.midiError=midiAccessError(error);this.onState();throw new Error(this.midiError);
    }
  }
  outputs() { return this.access?[...this.access.outputs.values()]:[]; }
  inputs() { return this.access?.inputs?[...this.access.inputs.values()]:[]; }
  available(id) {return this.outputs().find(p=>p.id===id && p.state!=='disconnected')||null;}
  syncPorts() {
    const next=this.available(this.outputId),cc=this.available(this.ccOutputId);
    // Preserve chosen IDs for reconnect, but do not silently change route or re-arm.
    if((this.output && this.output!==next)||(this.ccOutput && this.ccOutput!==cc))
      this.panic('MIDI destination disconnected or changed');
    this.output=next;this.ccOutput=cc;this.onState();
  }
  select(id,channel=1) {
    const next=id?this.available(id):null;
    if(id&&!next) throw new Error('That MIDI output is unavailable. Refresh outputs or choose another destination.');
    this.panic('Output changed');
    this.outputId=id;this.output=next;
    this.channel=clamp(Math.round(channel)-1,0,15);this.onState();
  }
  selectCC(id) {
    const next=id?this.available(id):null;
    if(id&&!next) throw new Error('That colour output is unavailable. Refresh outputs or choose another destination.');
    this.panic('Colour output changed');this.ccOutputId=id;this.ccOutput=next;this.onState();
  }
  async arm() {
    const generation=++this.generation;
    if(this.midiState==='requesting') throw new Error('Wait for MIDI discovery to finish before arming.');
    if(this.outputId && (!this.output || this.output.state==='disconnected'))
      throw new Error('The selected MIDI output is unavailable. Reconnect it or select None to use preview only.');
    if(this.output) {
      try {await this.output.open?.();}
      catch(error) {this.panic('MIDI output could not open');throw new Error(`Cannot open MIDI output: ${error.message}`);}
    }
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
