import Player from 'xgplayer'
import { EVENTS, Context } from 'xgplayer-helper-utils'
import FLV from './flv-live'
import defaultConfig from './config'

const flvAllowedEvents = EVENTS.FlvAllowedEvents;
const { BasePlugin, Events } = Player;

class FlvPlayer extends BasePlugin {
  static get pluginName () {
    return 'flvLive'
  }

  constructor (config) {
    super(config);
    this.options = Object.assign({}, defaultConfig, this.config)
    this.context = new Context(flvAllowedEvents);
    this.loaderCompleteTimer = null;
    this.play = this.play.bind(this);
    this.pause = this.pause.bind(this);
    this.destroy = this.destroy.bind(this);
    this.switchURL = this.switchURL.bind(this);
    this.handleDefinitionChange = this.handleDefinitionChange.bind(this);

    this.autoPlayStarted = false;
    this.played = false;
    this.initEvents()
  }

  beforePlayerInit () {
    this.initFlv()
    this.context.init()
    this.loadData()
    this.player.swithURL = this.swithURL;
    try {
      BasePlugin.defineGetterOrSetter(this.player, {
        '__url': {
          get: () => {
            return this.mse.url
          }
        }
      })
    } catch (e) {
      // NOOP
    }
  }

  initFlvEvents (flv) {
    const player = this.player;
    flv.once(EVENTS.REMUX_EVENTS.INIT_SEGMENT, () => {
      BasePlugin.Util.addClass(player.root, 'xgplayer-is-live')
    })

    flv.once(EVENTS.LOADER_EVENTS.LOADER_COMPLETE, () => {
      // 直播完成，待播放器播完缓存后发送关闭事件
      if (!player.paused) {
        this.loaderCompleteTimer = setInterval(() => {
          if (!player) return window.clearInterval(this.loaderCompleteTimer)
          const end = player.getBufferedRange()[1]
          if (Math.abs(player.currentTime - end) < 0.5) {
            player.emit('ended')
            window.clearInterval(this.loaderCompleteTimer)
          }
        }, 200)
      } else {
        player.emit('ended')
      }
    })

    flv.on(EVENTS.REMUX_EVENTS.DETECT_CHANGE_STREAM_DISCONTINUE, () => {
      this.player.emit(EVENTS.REMUX_EVENTS.DETECT_CHANGE_STREAM_DISCONTINUE)
    })

    flv.on(EVENTS.LOADER_EVENTS.NO_DATA_RECEVIE, () => {
      this.reload()
    })
  }

  initFlvBackupEvents (flv, ctx) {
    let mediaLength = 3;
    flv.on(EVENTS.REMUX_EVENTS.MEDIA_SEGMENT, () => {
      mediaLength -= 1;
      if (mediaLength === 0) {
        // ensure switch smoothly
        this.flv = flv;
        this.player.flv = flv
        this.mse.resetContext(ctx);
        this.context.destroy();
        this.context = ctx;
      }
    })

    flv.once(EVENTS.LOADER_EVENTS.LOADER_COMPLETE, () => {
      // 直播完成，待播放器播完缓存后发送关闭事件
      if (!this.paused) {
        this.loaderCompleteTimer = setInterval(() => {
          if (!this.player) return window.clearInterval(this.loaderCompleteTimer)
          const end = this.player.getBufferedRange()[1]
          if (Math.abs(this.player.currentTime - end) < 0.5) {
            this.emit('ended')
            window.clearInterval(this.loaderCompleteTimer)
          }
        }, 200)
      } else {
        this.emit('ended')
      }
    })

    flv.once(EVENTS.LOADER_EVENTS.LOADER_ERROR, () => {
      ctx.destroy()
    })

    flv.on(EVENTS.REMUX_EVENTS.DETECT_CHANGE_STREAM_DISCONTINUE, () => {
      this.player.emit(EVENTS.REMUX_EVENTS.DETECT_CHANGE_STREAM_DISCONTINUE)
    })

    flv.on(EVENTS.LOADER_EVENTS.NO_DATA_RECEVIE, () => {
      this.reload()
    })
  }

  initEvents () {
    this.on('seeking', () => {
      const time = this.player.currentTime
      const range = this.player.getBufferedRange()
      if (time > range[1] || time < range[0]) {
        this.flv.seek(this.player.currentTime)
      }
    })
    this.on(Events.PLAY, this.play)
    this.on(Events.PAUSE, this.pause)
    this.on(Events.DESTROY, this.destroy)
    this.on(Events.URL_CHANGE, this.switchURL)
    this.on(Events.DEFINITION_CHANGE, this.switchURL)
    if (this.playerConfig.autoplay) {
      this.on(Events.AUTOPLAY_STARTED, () => {
        this.autoPlayStarted = true;
      })
    }
  }

  initFlv () {
    const flv = this.context.registry('FLV_CONTROLLER', FLV)(this.player, undefined, this.options)
    this.initFlvEvents(flv)
    this.player.flv = flv
    this.flv = flv
    this.mse = flv.mse;
    return flv;
  }

  play () {
    if (this.playerConfig.autoplay && this.autoPlayStarted === false) {
      // autoplay not started
      this.played = true;
      return;
    }
    if (this.played && (this.player.hasStart || this.player.played.length)) {
      this.played = false;
      return this.reload();
    }
    this.played = true;
  }

  reload () {
    return this._destroy().then(() => {
      this.initEvents();
      this.context = new Context(flvAllowedEvents)
      setTimeout(() => {
        if (!this.player) return
        this.player.hasStart = false;
        this.player.start()
      })
      this.player.onWaiting();
    })
  }

  pause () {
    if (this.playerConfig.autoplay && this.autoPlayStarted === false) {
      return;
    }
    if (this.flv) {
      this.flv.pause()
    }
  }

  loadData (time = this.player.currentTime) {
    if (this.player.flv) {
      this.player.flv.seek(time)
    }
  }

  destroy () {
    return this._destroy()
  }

  _destroy () {
    if (!this.context) return Promise.resolve()
    if (this.flv && this.flv._context) {
      const loader = this.flv._context.getInstance('FETCH_LOADER')
      loader && loader.destroy()
    }
    const clear = () => {
      if (!this.context) return
      this.context.destroy()
      this.flv = null
      this.context = null
      this.played = false
      if (this.loaderCompleteTimer) {
        window.clearInterval(this.loaderCompleteTimer)
      }
      super.offAll();
    }
    return this.flv && this.flv.mse ? this.flv.mse.destroy().then(clear) : Promise.resolve(clear())
  }

  handleDefinitionChange (change) {
    const { to } = change;
    this.switchURL(to);
  }

  switchURL (url) {
    this.played = false
    this.player.currentTime = 0;
    this.player.config.url = url;
    const context = new Context(flvAllowedEvents);
    const flv = context.registry('FLV_CONTROLLER', FLV)(this.player, this.mse, this.options)
    context.init()
    this.initFlvBackupEvents(flv, context);
    flv.loadData(url);
  }

  static isSupported () {
    return window.MediaSource &&
      window.MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"');
  }
}

export default FlvPlayer
