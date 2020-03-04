'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _typeof = typeof Symbol === "function" && typeof Symbol.iterator === "symbol" ? function (obj) { return typeof obj; } : function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; };

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _xgplayerTransmuxerConstantEvents = require('xgplayer-transmuxer-constant-events');

var _xgplayerTransmuxerConstantEvents2 = _interopRequireDefault(_xgplayerTransmuxerConstantEvents);

var _xgplayerTransmuxerBufferStream = require('xgplayer-transmuxer-buffer-stream');

var _xgplayerTransmuxerBufferStream2 = _interopRequireDefault(_xgplayerTransmuxerBufferStream);

var _xgplayerTransmuxerCodecAac = require('xgplayer-transmuxer-codec-aac');

var _xgplayerTransmuxerCodecAvc = require('xgplayer-transmuxer-codec-avc');

var _xgplayerTransmuxerCodecHevc = require('xgplayer-transmuxer-codec-hevc');

var _xgplayerTransmuxerBufferTrack = require('xgplayer-transmuxer-buffer-track');

var _xgplayerTransmuxerModelTrackmeta = require('xgplayer-transmuxer-model-trackmeta');

var _xgplayerTransmuxerModelTracksample = require('xgplayer-transmuxer-model-tracksample');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var DEMUX_EVENTS = _xgplayerTransmuxerConstantEvents2.default.DEMUX_EVENTS;
var StreamType = {
  0x01: ['video', 'MPEG-1'],
  0x02: ['video', 'MPEG-2'],
  0x1b: ['video', 'AVC.H264'],
  0x24: ['video', 'HVC.H265'],
  0xea: ['video', 'VC-1'],
  0x03: ['audio', 'MPEG-1'],
  0x04: ['audio', 'MPEG-2'],
  0x0f: ['audio', 'MPEG-2.AAC'],
  0x11: ['audio', 'MPEG-4.AAC'],
  0x80: ['audio', 'LPCM'],
  0x81: ['audio', 'AC3'],
  0x06: ['audio', 'AC3'],
  0x82: ['audio', 'DTS'],
  0x83: ['audio', 'Dolby TrueHD'],
  0x84: ['audio', 'AC3-Plus'],
  0x85: ['audio', 'DTS-HD'],
  0x86: ['audio', 'DTS-MA'],
  0xa1: ['audio', 'AC3-Plus-SEC'],
  0xa2: ['audio', 'DTS-HD-SEC']
};

var TsDemuxer = function () {
  function TsDemuxer(configs) {
    _classCallCheck(this, TsDemuxer);

    this.configs = Object.assign({}, configs);
    this.demuxing = false;
    this.pat = [];
    this.pmt = [];
    this._hasVideoMeta = false;
    this._hasAudioMeta = false;
  }

  _createClass(TsDemuxer, [{
    key: 'init',
    value: function init() {
      this.on(DEMUX_EVENTS.DEMUX_START, this.demux.bind(this));
    }
  }, {
    key: 'demux',
    value: function demux(frag) {
      if (this.demuxing) {
        return;
      }

      var buffer = this.inputBuffer;
      var frags = { pat: [], pmt: [] };
      var peses = {};

      // Read TS segment
      while (buffer.length >= 188) {
        if (buffer.length >= 1 && buffer.array[0][buffer.offset] !== 71) {
          this.emit(DEMUX_EVENTS.DEMUX_ERROR, this.TAG, new Error('Untrust sync code: ' + buffer.array[0][buffer.offset] + ', try to recover;'), false);
        }
        while (buffer.length >= 1 && buffer.array[0][buffer.offset] !== 71) {
          buffer.shift(1);
        }
        if (buffer.length < 188) {
          continue;
        }
        var buf = buffer.shift(188);
        // console.log(buf);
        var tsStream = new _xgplayerTransmuxerBufferStream2.default(buf.buffer);
        var ts = {};
        TsDemuxer.read(tsStream, ts, frags);
        if (ts.pes) {
          ts.pes.codec = ts.header.codec;
          if (!peses[ts.header.pid]) {
            peses[ts.header.pid] = [];
          }
          peses[ts.header.pid].push(ts.pes);
          ts.pes.ES.buffer = [ts.pes.ES.buffer];
        } else if (peses[ts.header.pid]) {
          peses[ts.header.pid][peses[ts.header.pid].length - 1].ES.buffer.push(ts.payload.stream);
        }
      }

      var AudioOptions = Object.assign({}, frag);
      var VideoOptions = Object.assign({}, frag);

      // Get Frames data
      for (var i = 0; i < Object.keys(peses).length; i++) {
        var epeses = peses[Object.keys(peses)[i]];
        for (var j = 0; j < epeses.length; j++) {
          epeses[j].id = Object.keys(peses)[i];

          if (epeses[j].type === 'audio') {
            epeses[j].ES.buffer = TsDemuxer.mergeAudioES(epeses[j].ES.buffer);
            this.pushAudioSample(epeses[j], AudioOptions);
            AudioOptions = {};
          } else if (epeses[j].type === 'video') {
            epeses[j].ES.buffer = TsDemuxer.mergeVideoES(epeses[j].ES.buffer);
            if (epeses[j].codec === 'HVC.H265') {
              this.pushVideoSampleHEVC(epeses[j], VideoOptions);
            } else {
              this.pushVideoSample(epeses[j], VideoOptions);
            }
            VideoOptions = {};
          }
        }
      }

      if (this._hasAudioMeta) {
        this.emit(DEMUX_EVENTS.DEMUX_COMPLETE, 'audio');
      }
      if (this._hasVideoMeta) {
        this.emit(DEMUX_EVENTS.DEMUX_COMPLETE, 'video');
      }
    }
  }, {
    key: 'pushAudioSample',
    value: function pushAudioSample(pes, options) {
      var _track$samples;

      var track = void 0;
      if (!this._tracks || !this._tracks.audioTrack) {
        this._tracks.audioTrack = new _xgplayerTransmuxerBufferTrack.AudioTrack();
        track = this._tracks.audioTrack;
      } else {
        track = this._tracks.audioTrack;
      }
      var meta = new _xgplayerTransmuxerModelTrackmeta.AudioTrackMeta({
        audioSampleRate: pes.ES.frequence,
        sampleRate: pes.ES.frequence,
        channelCount: pes.ES.channel,
        codec: 'mp4a.40.' + pes.ES.audioObjectType,
        config: pes.ES.audioConfig,
        id: 2,
        sampleRateIndex: pes.ES.frequencyIndex
      });
      meta.refSampleDuration = Math.floor(1024 / meta.audioSampleRate * meta.timescale);

      var metaEqual = TsDemuxer.compaireMeta(track.meta, meta, true);

      if (!this._hasAudioMeta || !metaEqual) {
        track.meta = meta;
        this._hasAudioMeta = true;
        if (options) {
          options.meta = Object.assign({}, meta);
        } else {
          options = {
            meta: Object.assign({}, meta)
          };
        }
        this.emit(DEMUX_EVENTS.METADATA_PARSED, 'audio');
      }

      var frameIndex = 0;
      var samples = [];

      pes.ES.buffer.skip(pes.pesHeaderLength + 9);
      var streamChanged = false;
      while (pes.ES.buffer.position < pes.ES.buffer.length) {
        if (_xgplayerTransmuxerCodecAac.ADTS.isHeader(new Uint8Array(pes.ES.buffer.buffer), pes.ES.buffer.position) && pes.ES.buffer.position + 5 < pes.ES.buffer.length) {
          var frame = _xgplayerTransmuxerCodecAac.ADTS.appendFrame(track, new Uint8Array(pes.ES.buffer.buffer), pes.ES.buffer.position, pes.pts, frameIndex);
          if (frame && frame.sample) {
            // logger.log(`${Math.round(frame.sample.pts)} : AAC`);
            pes.ES.buffer.skip(frame.length);
            var sample = new _xgplayerTransmuxerModelTracksample.AudioTrackSample({
              dts: frame.sample.dts,
              pts: frame.sample.pts,
              data: frame.sample.unit,
              options: streamChanged ? {} : options
            });
            if (options.meta) {
              streamChanged = true;
            }
            samples.push(sample);
            frameIndex++;
          } else {
            // logger.log('Unable to parse AAC frame');
            break;
          }
        } else {
          // nothing found, keep looking
          pes.ES.buffer.skip(1);
        }
      }
      for (var i = 0; i < samples.length; i++) {
        var _sample = samples[i];
        _sample.dts = _sample.pts = Math.ceil(_sample.pts / 90);
      }

      // let data = new Uint8Array(pes.ES.buffer.buffer.slice(pes.ES.buffer.position, pes.ES.buffer.length));
      // let sample = new AudioTrackSample({dts, pts, data, options});
      (_track$samples = track.samples).push.apply(_track$samples, samples);
    }
  }, {
    key: 'pushVideoSample',
    value: function pushVideoSample(pes, options) {
      var nals = _xgplayerTransmuxerCodecAvc.NalUnit.getNalunits(pes.ES.buffer);
      var track = void 0;
      var meta = new _xgplayerTransmuxerModelTrackmeta.VideoTrackMeta();
      if (!this._tracks || !this._tracks.videoTrack) {
        this._tracks.videoTrack = new _xgplayerTransmuxerBufferTrack.VideoTrack();
        track = this._tracks.videoTrack;
      } else {
        track = this._tracks.videoTrack;
      }
      var sampleLength = 0;
      var sps = false;
      var pps = false;
      for (var i = 0; i < nals.length; i++) {
        var nal = nals[i];
        if (nal.sps) {
          sps = nal;
          track.sps = nal.body;
          meta.chromaFormat = sps.sps.chroma_format;
          meta.codec = 'avc1.';
          for (var j = 1; j < 4; j++) {
            var h = sps.body[j].toString(16);
            if (h.length < 2) {
              h = '0' + h;
            }
            meta.codec += h;
          }
          meta.codecHeight = sps.sps.codec_size.height;
          meta.codecWidth = sps.sps.codec_size.width;
          meta.frameRate = sps.sps.frame_rate;
          meta.id = 1;
          meta.level = sps.sps.level_string;
          meta.presentHeight = sps.sps.present_size.height;
          meta.presentWidth = sps.sps.present_size.width;
          meta.profile = sps.sps.profile_string;
          meta.refSampleDuration = Math.floor(meta.timescale * (sps.sps.frame_rate.fps_den / sps.sps.frame_rate.fps_num));
          meta.sarRatio = sps.sps.sar_ratio ? sps.sps.sar_ratio : sps.sps.par_ratio;
        } else if (nal.pps) {
          track.pps = nal.body;
          pps = nal;
        } else if (nal.sei) {
          this.emit(DEMUX_EVENTS.SEI_PARSED, nal.sei);
        } else if (nal.type < 9) {
          sampleLength += 4 + nal.body.byteLength;
        }
      }

      if (sps && pps) {
        meta.avcc = _xgplayerTransmuxerCodecAvc.NalUnit.getAvcc(sps.body, pps.body);
        var metaEqual = TsDemuxer.compaireMeta(track.meta, meta, true);
        if (!this._hasVideoMeta || !metaEqual) {
          if (options) {
            options.meta = Object.assign({}, meta);
          } else {
            options = {
              meta: Object.assign({}, meta)
            };
          }
          track.meta = meta;
          this._hasVideoMeta = true;
          this.emit(DEMUX_EVENTS.METADATA_PARSED, 'video');
        }
      }

      var data = new Uint8Array(sampleLength);
      var offset = 0;
      var isKeyframe = false;
      for (var _i = 0; _i < nals.length; _i++) {
        var _nal = nals[_i];
        if (_nal.type && _nal.type >= 9) {
          continue;
        }
        var length = _nal.body.byteLength;
        if (_nal.idr) {
          isKeyframe = true;
        }
        if (!_nal.pps && !_nal.sps && !_nal.sei) {
          data.set(new Uint8Array([length >>> 24 & 0xff, length >>> 16 & 0xff, length >>> 8 & 0xff, length & 0xff]), offset);
          offset += 4;
          data.set(_nal.body, offset);
          offset += length;
        }
      }
      var sample = new _xgplayerTransmuxerModelTracksample.VideoTrackSample({
        dts: parseInt(pes.dts / 90),
        pts: parseInt(pes.pts / 90),
        cts: (pes.pts - pes.dts) / 90,
        originDts: pes.dts,
        isKeyframe: isKeyframe,
        data: data,
        options: options
      });
      track.samples.push(sample);
    }
  }, {
    key: 'pushVideoSampleHEVC',
    value: function pushVideoSampleHEVC(pes, options) {
      var nals = _xgplayerTransmuxerCodecHevc.NalUnitHEVC.getNalunits(pes.ES.buffer);
      var track = void 0;
      var meta = new _xgplayerTransmuxerModelTrackmeta.VideoTrackMeta();
      meta.streamType = 0x24;
      if (!this._tracks.videoTrack) {
        this._tracks.videoTrack = new _xgplayerTransmuxerBufferTrack.VideoTrack();
        track = this._tracks.videoTrack;
      } else {
        track = this._tracks.videoTrack;
      }

      var sampleLength = 0;
      var vps = false;
      var sps = false;
      var pps = false;
      var hasVPS = false;
      var hasSPS = false;
      var hasPPS = false;
      for (var i = 0; i < nals.length; i++) {
        var nal = nals[i];
        if (nal.vps) {
          if (hasVPS) {
            continue;
          } else {
            hasVPS = true;
          }
        } else if (nal.sps) {
          if (hasSPS) {
            continue;
          } else {
            hasSPS = true;
          }
        } else if (nal.pps) {
          if (hasPPS) {
            continue;
          } else {
            hasPPS = true;
          }
        }
        if (nal.sps) {
          sps = nal;
          track.sps = nal.body;
          // meta.chromaFormat = sps.sps.chroma_format
          // meta.codec = 'hvc1.';
          // for (var j = 1; j < 4; j++) {
          //   var h = sps.body[j].toString(16);
          //   if (h.length < 2) {
          //     h = '0' + h;
          //   }
          //   meta.codec += h;
          // }
          // meta.codecHeight = sps.sps.codec_size.height;
          // meta.codecWidth = sps.sps.codec_size.width;
          // meta.frameRate = sps.sps.frame_rate;
          // meta.id = 1;
          // meta.level = sps.sps.level_string;
          // meta.presentHeight = sps.sps.present_size.height;
          // meta.presentWidth = sps.sps.present_size.width;
          // meta.profile = sps.sps.profile_string;
          // meta.refSampleDuration = Math.floor(meta.timescale * (sps.sps.frame_rate.fps_den / sps.sps.frame_rate.fps_num));
          // meta.sarRatio = sps.sps.sar_ratio ? sps.sps.sar_ratio : sps.sps.par_ratio;

          meta.presentWidth = sps.sps.width;
          meta.presentHeight = sps.sps.height;
          meta.general_profile_space = sps.sps.general_profile_space;
          meta.general_tier_flag = sps.sps.general_tier_flag;
          meta.general_profile_idc = sps.sps.general_profile_idc;
          meta.general_level_idc = sps.sps.general_level_idc;
          // meta.duration = this._duration;
          meta.codec = 'hev1.1.6.L93.B0';
          meta.chromaFormatIdc = sps.sps.chromaFormatIdc;
          meta.bitDepthLumaMinus8 = sps.sps.bitDepthLumaMinus8;
          meta.bitDepthChromaMinus8 = sps.sps.bitDepthChromaMinus8;
        } else if (nal.pps) {
          track.pps = nal.body;
          pps = nal;
        } else if (nal.vps) {
          track.vps = nal.body;
          vps = nal;
        }
        if (nal.type <= 40) {
          sampleLength += 4 + nal.body.byteLength;
        }
      }

      if (sps && pps && vps) {
        // meta.avcc = NalUnitHEVC.getAvcc(sps.body, pps.body);
        var metaEqual = TsDemuxer.compaireMeta(track.meta, meta, true);
        if (!this._hasVideoMeta || !metaEqual) {
          if (options) {
            options.meta = Object.assign({}, meta);
          } else {
            options = {
              meta: Object.assign({}, meta)
            };
          }
          meta.streamType = 0x24;
          this._tracks.videoTrack.meta = meta;
          this._hasVideoMeta = true;
          this.emit(DEMUX_EVENTS.METADATA_PARSED, 'video');
        }
      }

      var data = new Uint8Array(sampleLength);
      var offset = 0;
      var isKeyframe = false;
      hasVPS = false;
      hasSPS = false;
      hasPPS = false;
      for (var _i2 = 0; _i2 < nals.length; _i2++) {
        var _nal2 = nals[_i2];
        if (_nal2.type && _nal2.type > 40) {
          continue;
        }
        if (_nal2.vps) {
          if (hasVPS) {
            continue;
          } else {
            hasVPS = true;
          }
        } else if (_nal2.sps) {
          if (hasSPS) {
            continue;
          } else {
            hasSPS = true;
          }
        } else if (_nal2.pps) {
          if (hasPPS) {
            continue;
          } else {
            hasPPS = true;
          }
        }
        var length = _nal2.body.byteLength;
        if (_nal2.key) {
          isKeyframe = true;
        }
        // if (!nal.vps && !nal.pps && !nal.sps) {
        data.set(new Uint8Array([length >>> 24 & 0xff, length >>> 16 & 0xff, length >>> 8 & 0xff, length & 0xff]), offset);
        offset += 4;
        data.set(_nal2.body, offset);
        offset += length;
        // }
      }
      var sample = new _xgplayerTransmuxerModelTracksample.VideoTrackSample({
        dts: parseInt(pes.dts / 90),
        pts: parseInt(pes.pts / 90),
        cts: (pes.pts - pes.dts) / 90,
        originDts: pes.dts,
        isKeyframe: isKeyframe,
        data: data,
        options: options
      });
      track.samples.push(sample);
    }
  }, {
    key: 'destory',
    value: function destory() {
      this.off(DEMUX_EVENTS.DEMUX_START, this.demux);
      this.configs = {};
      this.demuxing = false;
      this.pat = [];
      this.pmt = [];
      this._hasVideoMeta = false;
      this._hasAudioMeta = false;
    }
  }, {
    key: 'inputBuffer',
    get: function get() {
      return this._context.getInstance(this.configs.inputbuffer);
    }
  }, {
    key: '_tracks',
    get: function get() {
      return this._context.getInstance('TRACKS');
    }
  }], [{
    key: 'compaireArray',
    value: function compaireArray(a, b, type) {
      var al = 0;
      var bl = 0;
      if (type === 'Uint8Array') {
        al = a.byteLength;
        bl = b.byteLength;
      } else if (type === 'Array') {
        al = a.length;
        bl = b.length;
      }
      if (al !== bl) {
        return false;
      }

      for (var i = 0; i < al; i++) {
        if (a[i] !== b[i]) {
          return false;
        }
      }
      return true;
    }
  }, {
    key: 'compaireMeta',
    value: function compaireMeta(a, b, ignoreDuration) {
      if (!a || !b) {
        return false;
      }

      for (var i = 0, k = Object.keys(a).length; i < k; i++) {
        var itema = a[Object.keys(a)[i]];
        var itemb = b[Object.keys(a)[i]];
        if (!itema && !itemb) {
          return true;
        }

        if (!itema && itemb || itema && !itemb) {
          return false;
        }

        if ((typeof itema === 'undefined' ? 'undefined' : _typeof(itema)) !== 'object') {
          if (ignoreDuration && Object.keys(a)[i] !== 'duration' && Object.keys(a)[i] !== 'refSampleDuration' && Object.keys(a)[i] !== 'refSampleDurationFixed' && itema !== itemb) {
            return false;
          }
        } else if (itema.byteLength !== undefined) {
          if (itemb.byteLength === undefined) {
            return false;
          }
          if (!TsDemuxer.compaireArray(itema, itemb, 'Uint8Array')) {
            return false;
          }
        } else if (itema.length !== undefined) {
          if (itemb.length === undefined) {
            return false;
          }
          if (!TsDemuxer.compaireArray(itema, itemb, 'Array')) {
            return false;
          }
        } else {
          if (!TsDemuxer.compaireMeta(itema, itemb)) {
            return false;
          }
        }
      }
      return true;
    }
  }, {
    key: 'mergeVideoES',
    value: function mergeVideoES(buffers) {
      var data = void 0;
      var length = 0;
      var offset = 0;
      for (var i = 0; i < buffers.length; i++) {
        length += buffers[i].length - buffers[i].position;
      }

      data = new Uint8Array(length);
      for (var _i3 = 0; _i3 < buffers.length; _i3++) {
        var buffer = buffers[_i3];
        data.set(new Uint8Array(buffer.buffer, buffer.position), offset);
        offset += buffer.length - buffer.position;
      }
      return new _xgplayerTransmuxerBufferStream2.default(data.buffer);
    }
  }, {
    key: 'mergeAudioES',
    value: function mergeAudioES(buffers) {
      var data = void 0;
      var length = 0;
      var offset = 0;
      for (var i = 0; i < buffers.length; i++) {
        length += buffers[i].length;
      }

      data = new Uint8Array(length);
      for (var _i4 = 0; _i4 < buffers.length; _i4++) {
        var buffer = buffers[_i4];
        data.set(new Uint8Array(buffer.buffer), offset);
        offset += buffer.length;
      }

      return new _xgplayerTransmuxerBufferStream2.default(data.buffer);
    }
  }, {
    key: 'read',
    value: function read(stream, ts, frags) {
      TsDemuxer.readHeader(stream, ts);
      TsDemuxer.readPayload(stream, ts, frags);
      if (ts.header.packet === 'MEDIA' && ts.header.payload === 1 && !ts.unknownPIDs) {
        ts.pes = TsDemuxer.PES(ts);
      }
    }
  }, {
    key: 'readPayload',
    value: function readPayload(stream, ts, frags) {
      var header = ts.header;
      var pid = header.pid;
      switch (pid) {
        case 0:
          TsDemuxer.PAT(stream, ts, frags);
          break;
        case 1:
          TsDemuxer.CAT(stream, ts, frags);
          break;
        case 2:
          TsDemuxer.TSDT(stream, ts, frags);
          break;
        case 0x1fff:
          break;
        default:
          // TODO: some的写法不太好，得改
          if (frags.pat.some(function (item) {
            return item.pid === pid;
          })) {
            TsDemuxer.PMT(stream, ts, frags);
          } else {
            var sts = frags.pmt ? frags.pmt.filter(function (item) {
              return item.pid === pid;
            }) : [];
            if (sts.length > 0) {
              TsDemuxer.Media(stream, ts, StreamType[sts[0].streamType][0]);
              ts.header.codec = StreamType[sts[0].streamType][1];
            } else {
              ts.unknownPIDs = true;
            }
            ;
          }
      }
    }
  }, {
    key: 'readHeader',
    value: function readHeader(stream, ts) {
      var header = {};
      header.sync = stream.readUint8();
      var next = stream.readUint16();
      header.error = next >>> 15;
      header.payload = next >>> 14 & 1;
      header.priority = next >>> 13 & 1;
      header.pid = next & 0x1fff;

      next = stream.readUint8();

      header.scrambling = next >> 6 & 0x3; // 是否加密，00表示不加密

      /**
       * 00 ISO/IEC未来使用保留
       * 01 没有调整字段，仅含有184B有效净荷
       * 02 没有有效净荷，仅含有183B调整字段
       * 03 0~182B调整字段后为有效净荷
       */
      header.adaptation = next >> 4 & 0x3;
      header.continuity = next & 15;
      header.packet = header.pid === 0 ? 'PAT' : 'MEDIA';
      ts.header = header;
    }
  }, {
    key: 'PAT',
    value: function PAT(stream, ts, frags) {
      var ret = {};
      var next = stream.readUint8();
      stream.skip(next);
      next = stream.readUint8();
      ret.tabelID = next;
      next = stream.readUint16();
      ret.error = next >>> 7;
      ret.zero = next >>> 6 & 1;
      ret.sectionLength = next & 0xfff;
      ret.streamID = stream.readUint16();
      ret.current = stream.readUint8() & 1;
      ret.sectionNumber = stream.readUint8();
      ret.lastSectionNumber = stream.readUint8();
      var N = (ret.sectionLength - 9) / 4;
      var list = [];
      for (var i = 0; i < N; i++) {
        var programNumber = stream.readUint16();
        var pid = stream.readUint16() & 0x1fff;
        list.push({
          program: programNumber,
          pid: pid,
          type: programNumber === 0 ? 'network' : 'mapPID'
        });
      }
      if (list.length > 0) {
        frags.pat = frags.pat.concat(list);
      }
      ret.list = list;
      ret.program = stream.readUint16();
      ret.pid = stream.readUint16() & 0x1fff;
      ts.payload = ret;
      // TODO CRC
    }
  }, {
    key: 'PMT',
    value: function PMT(stream, ts, frags) {
      var ret = {};
      var header = ts.header;
      header.packet = 'PMT';
      var next = stream.readUint8();
      stream.skip(next);
      next = stream.readUint8();
      ret.tableID = next;
      next = stream.readUint16();
      ret.sectionLength = next & 0xfff;
      ret.program = stream.readUint16();
      ret.current = stream.readUint8() & 1;
      ret.order = stream.readUint8();
      ret.lastOrder = stream.readUint8();
      ret.PCR_PID = stream.readUint16() & 0x1fff;
      ret.programLength = stream.readUint16() & 0xfff;
      var N = (ret.sectionLength - 13) / 5;
      var list = [];
      for (var i = 0; i < N; i++) {
        list.push({
          streamType: stream.readUint8(),
          pid: stream.readUint16() & 0x1fff, // 0x07e5 视频，0x07e6
          es: stream.readUint16() & 0xfff
        });
      }
      ret.list = list;
      if (!this.pmt) {
        this.pmt = [];
      }
      frags.pmt = this.pmt.concat(list.map(function (item) {
        return {
          pid: item.pid,
          es: item.es,
          streamType: item.streamType,
          program: ret.program
        };
      }));
      ts.payload = ret;
    }
  }, {
    key: 'Media',
    value: function Media(stream, ts, type) {
      var header = ts.header;
      var payload = {};
      header.type = type;
      if (header.adaptation === 0x03) {
        payload.adaptationLength = stream.readUint8();
        if (payload.adaptationLength > 0) {
          var next = stream.readUint8();
          payload.discontinue = next >>> 7;
          payload.access = next >>> 6 & 0x01;
          payload.priority = next >>> 5 & 0x01;
          payload.PCR = next >>> 4 & 0x01;
          payload.OPCR = next >>> 3 & 0x01;
          payload.splicePoint = next >>> 2 & 0x01;
          payload.transportPrivate = next >>> 1 & 0x01;
          payload.adaptationField = next & 0x01;
          var _start = stream.position;
          if (payload.PCR === 1) {
            payload.programClockBase = stream.readUint32() << 1;
            next = stream.readUint16();
            payload.programClockBase |= next >>> 15;
            payload.programClockExtension = next & 0x1ff;
          }
          if (payload.OPCR === 1) {
            payload.originProgramClockBase = stream.readUint32() << 1;
            next = stream.readUint16();
            payload.originProgramClockBase += next >>> 15;
            payload.originProgramClockExtension = next & 0x1ff;
          }
          if (payload.splicePoint === 1) {
            payload.spliceCountdown = stream.readUint8();
          }
          if (payload.transportPrivate === 1) {
            var length = stream.readUint8();
            var transportPrivateData = [];
            for (var i = 0; i < length; i++) {
              transportPrivateData.push(stream.readUint8());
            }
          }
          if (payload.adaptationField === 1) {
            var _length = stream.readUint8();
            var _next = stream.readUint8();
            var start = stream.position;
            var ltw = _next >>> 7;
            var piecewise = _next >>> 6 & 0x1;
            var seamless = _next >>> 5 & 0x1;
            if (ltw === 1) {
              _next = stream.readUint16();
              payload.ltwValid = _next >>> 15;
              payload.ltwOffset = _next & 0xefff;
            }
            if (piecewise === 1) {
              _next = stream.readUint24();
              payload.piecewiseRate = _next & 0x3fffff;
            }
            if (seamless === 1) {
              _next = stream.readInt8();
              payload.spliceType = _next >>> 4;
              payload.dtsNextAU1 = _next >>> 1 & 0x7;
              payload.marker1 = _next & 0x1;
              _next = stream.readUint16();
              payload.dtsNextAU2 = _next >>> 1;
              payload.marker2 = _next & 0x1;
              _next = stream.readUint16();
              payload.dtsNextAU3 = _next;
            }
            stream.skip(_length - 1 - (stream.position - start));
          }
          var lastStuffing = payload.adaptationLength - 1 - (stream.position - _start);
          stream.skip(lastStuffing);
        }
      }
      payload.stream = new _xgplayerTransmuxerBufferStream2.default(stream.buffer.slice(stream.position));
      ts.payload = payload;
    }
  }, {
    key: 'PES',
    value: function PES(ts) {
      var ret = {};
      var buffer = ts.payload.stream;

      var next = buffer.readUint24();
      if (next !== 1) {
        ret.ES = {};
        ret.ES.buffer = buffer;
      } else {
        var streamID = buffer.readUint8();
        if (streamID >= 0xe0 && streamID <= 0xef) {
          ret.type = 'video';
        }
        if (streamID >= 0xc0 && streamID <= 0xdf) {
          ret.type = 'audio';
        }
        var packetLength = buffer.readUint16();
        ret.packetLength = packetLength;
        if (ret.type === 'video' || ret.type === 'audio') {
          var _next2 = buffer.readUint8();
          var first = _next2 >>> 6;
          if (first !== 0x02) {
            throw new Error('error when parse pes header');
          }
          _next2 = buffer.readUint8();
          ret.ptsDTSFlag = _next2 >>> 6;
          ret.escrFlag = _next2 >>> 5 & 0x01;
          ret.esRateFlag = _next2 >>> 4 & 0x01;
          ret.dsmFlag = _next2 >>> 3 & 0x01;
          ret.additionalFlag = _next2 >>> 2 & 0x01;
          ret.crcFlag = _next2 >>> 1 & 0x01;
          ret.extensionFlag = _next2 & 0x01;
          ret.pesHeaderLength = buffer.readUint8();
          var N1 = ret.pesHeaderLength;

          if (ret.ptsDTSFlag === 2) {
            var pts = [];
            _next2 = buffer.readUint8();
            pts.push(_next2 >>> 1 & 0x07);
            _next2 = buffer.readUint16();
            pts.push(_next2 >>> 1);
            _next2 = buffer.readUint16();
            pts.push(_next2 >>> 1);
            ret.pts = pts[0] << 30 | pts[1] << 15 | pts[2];
            N1 -= 5;
            // 视频如果没有dts用pts
            if (ret.type === 'video') {
              ret.dts = ret.pts;
            }
          }
          if (ret.ptsDTSFlag === 3) {
            var _pts = [];
            _next2 = buffer.readUint8();
            _pts.push(_next2 >>> 1 & 0x07);
            _next2 = buffer.readUint16();
            _pts.push(_next2 >>> 1);
            _next2 = buffer.readUint16();
            _pts.push(_next2 >>> 1);
            ret.pts = _pts[0] << 30 | _pts[1] << 15 | _pts[2];
            var dts = [];
            _next2 = buffer.readUint8();
            dts.push(_next2 >>> 1 & 0x07);
            _next2 = buffer.readUint16();
            dts.push(_next2 >>> 1);
            _next2 = buffer.readUint16();
            dts.push(_next2 >>> 1);
            ret.dts = dts[0] << 30 | dts[1] << 15 | dts[2];
            N1 -= 10;
          }
          if (ret.escrFlag === 1) {
            var escr = [];
            var ex = [];
            _next2 = buffer.readUint8();
            escr.push(_next2 >>> 3 & 0x07);
            escr.push(_next2 & 0x03);
            _next2 = buffer.readUint16();
            escr.push(_next2 >>> 13);
            escr.push(_next2 & 0x03);
            _next2 = buffer.readUint16();
            escr.push(_next2 >>> 13);
            ex.push(_next2 & 0x03);
            _next2 = buffer.readUint8();
            ex.push(_next2 >>> 1);
            ret.escr = (escr[0] << 30 | escr[1] << 28 | escr[2] << 15 | escr[3] << 13 | escr[4]) * 300 + (ex[0] << 7 | ex[1]);
            N1 -= 6;
          }
          if (ret.esRateFlag === 1) {
            _next2 = buffer.readUint24();
            ret.esRate = _next2 >>> 1 & 0x3fffff;
            N1 -= 3;
          }
          if (ret.dsmFlag === 1) {
            throw new Error('not support DSM_trick_mode');
          }
          if (ret.additionalFlag === 1) {
            _next2 = buffer.readUint8();
            ret.additionalCopyInfo = _next2 & 0x7f;
            N1 -= 1;
          }
          if (ret.crcFlag === 1) {
            ret.pesCRC = buffer.readUint16();
            N1 -= 2;
          }
          if (ret.extensionFlag === 1) {
            throw new Error('not support extension');
          }
          if (N1 > 0) {
            buffer.skip(N1);
          }
          ret.ES = TsDemuxer.ES(buffer, ret.type);
        } else {
          throw new Error('format is not supported');
        }
      }
      return ret;
    }
  }, {
    key: 'ES',
    value: function ES(buffer, type) {
      var next = void 0;
      var ret = {};
      if (type === 'video') {
        // next = buffer.readUint32();
        // if (next !== 1) {
        //   buffer.back(4);
        //   next = buffer.readUint24();
        //   if (next !== 1) {
        //     throw new Error('h264 nal header parse failed');
        //   }
        // }
        // buffer.skip(2);// 09 F0
        // TODO readnalu
        ret.buffer = buffer;
      } else if (type === 'audio') {
        next = buffer.readUint16();
        // adts的同步字节，12位
        if (next >>> 4 !== 0xfff) {
          throw new Error('aac ES parse Error');
        }
        var fq = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
        ret.id = (next >>> 3 & 0x01) === 0 ? 'MPEG-4' : 'MPEG-2';
        ret.layer = next >>> 1 & 0x03;
        ret.absent = next & 0x01;
        next = buffer.readUint16();
        ret.audioObjectType = (next >>> 14 & 0x03) + 1;
        ret.profile = ret.audioObjectType - 1;
        ret.frequencyIndex = next >>> 10 & 0x0f;
        ret.frequence = fq[ret.frequencyIndex];
        ret.channel = next >>> 6 & 0x07;
        ret.frameLength = (next & 0x03) << 11 | buffer.readUint16() >>> 5;
        TsDemuxer.getAudioConfig(ret);
        buffer.skip(1);
        ret.buffer = buffer;
      } else {
        throw new Error('ES ' + type + ' is not supported');
      }

      return ret;
    }
  }, {
    key: 'TSDT',
    value: function TSDT(stream, ts, frags) {
      // TODO
      ts.payload = {};
    }
  }, {
    key: 'CAT',
    value: function CAT(stream, ts, frags) {
      var ret = {};
      ret.tableID = stream.readUint8();
      var next = stream.readUint16();
      ret.sectionIndicator = next >>> 7;
      ret.sectionLength = next & 0x0fff;
      stream.skip(2);
      next = stream.readUint8();
      ret.version = next >>> 3;
      ret.currentNextIndicator = next & 0x01;
      ret.sectionNumber = stream.readUint8();
      ret.lastSectionNumber = stream.readUint8();
      var N = (this.sectionLength - 9) / 4;
      var list = [];
      for (var i = 0; i < N; i++) {
        list.push({});
      }
      ret.crc32 = stream.readUint32();
      ts.payload = ret;
    }
  }, {
    key: 'getAudioConfig',
    value: function getAudioConfig(ret) {
      var userAgent = navigator.userAgent.toLowerCase();
      var config = void 0;
      var extensionSampleIndex = void 0;
      if (/firefox/i.test(userAgent)) {
        if (ret.frequencyIndex >= 6) {
          ret.audioObjectType = 5;
          config = new Array(4);
          extensionSampleIndex = ret.frequencyIndex - 3;
        } else {
          ret.audioObjectType = 2;
          config = new Array(2);
          extensionSampleIndex = ret.frequencyIndex;
        }
      } else if (userAgent.indexOf('android') !== -1) {
        ret.audioObjectType = 2;
        config = new Array(2);
        extensionSampleIndex = ret.frequencyIndex;
      } else {
        ret.audioObjectType = 5;
        config = new Array(4);
        if (ret.frequencyIndex >= 6) {
          extensionSampleIndex = ret.frequencyIndex - 3;
        } else {
          if (ret.channel === 1) {
            ret.audioObjectType = 2;
            config = new Array(2);
          }
          extensionSampleIndex = ret.frequencyIndex;
        }
      }

      config[0] = ret.audioObjectType << 3;
      config[0] |= (ret.frequencyIndex & 0x0e) >> 1;
      config[1] = (ret.frequencyIndex & 0x01) << 7;
      config[1] |= ret.channel << 3;
      if (ret.audioObjectType === 5) {
        config[1] |= (extensionSampleIndex & 0x0e) >> 1;
        config[2] = (extensionSampleIndex & 0x01) << 7;
        config[2] |= 2 << 2;
        config[3] = 0;
      }
      ret.audioConfig = config;
    }
  }]);

  return TsDemuxer;
}();

exports.default = TsDemuxer;