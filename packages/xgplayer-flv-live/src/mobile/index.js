import Player from 'xgplayer'
import { EVENTS, Context, common } from 'xgplayer-helper-utils'
import FLV from './flv-live-mobile'
import defaultConfig from './config'
const flvAllowedEvents = EVENTS.FlvAllowedEvents;
const { BasePlugin, Events } = Player;
const {softSolutionProbe} = common

class FlvPlayer extends BasePlugin {
  static get pluginName () {
    return 'flvLiveMobile'
  }

  static isSupported () {
    return softSolutionProbe();
  }

  constructor (options) {
    super(options);
    this.options = Object.assign({}, defaultConfig, this.config)
    this.play = this.play.bind(this)
    this.pause = this.pause.bind(this)
    this.canplay = this.canplay.bind(this)
    this.switchURL = this.switchURL.bind(this);
    this.progress = this.progress.bind(this);
    this.handleDefinitionChange = this.handleDefinitionChange.bind(this);
    this.lowdecode = this.lowdecode.bind(this);
  }

  beforePlayerInit () {
    const { player } = this;
    if (player.video && player.config.innerDegrade) {
      player.video.setAttribute('innerdegrade', player.config.innerDegrade);
    }
    if (player.video && player.config.preloadTime) {
      player.video.setAttribute('preloadtime', player.config.preloadTime);
    }
    this.context = new Context(flvAllowedEvents)
    this.initFlv()
    this.context.init()
    this.loadData()
    this.initEvents()
    if (!player.forceDegradeToVideo) {
      player.forceDegradeToVideo = this.forceDegradeToVideo.bind(this);
    }
  }

  afterCreate () {
    const { video, config } = this.player;
    video.width = Number.parseInt(config.width || 600)
    video.height = Number.parseInt(config.height || 337.5)
    video.style.outline = 'none';
  }

  initFlvEvents (flv) {
    const { player } = this;

    flv.once(EVENTS.LOADER_EVENTS.LOADER_COMPLETE, () => {
      // 直播完成，待播放器播完缓存后发送关闭事件
      if (!player.paused) {
        const timer = setInterval(() => {
          const end = player.getBufferedRange()[1]
          if (Math.abs(player.currentTime - end) < 0.5) {
            player.emit('ended')
            window.clearInterval(timer)
          }
        }, 200)
      }
    })
  }

  initEvents () {
    this.on(Events.PLAY, this.play);
    this.on(Events.PAUSE, this.pause);
    this.on(Events.CANPLAY, this.canplay);
    this.on(Events.URL_CHANGE, this.switchURL);
    this.on(Events.DEFINITION_CHANGE, this.handleDefinitionChange);
    this.on(Events.PROGRESS, this.progress)
    this.player.video.addEventListener('lowdecode', this.lowdecode)
  }

  // 降级时到不同的播放方式
  lowdecode () {
    const {player} = this;
    const {backupURL, innerDegrade} = player.config;

    this.emit('lowdecode', this.player.video.degradeInfo);

    // 内部降级到mse
    if (innerDegrade === 2) {
      this._degrade(null, true);
      this._toUseMse(backupURL);
    }

    // h5下内部降级到video播放m3u8
    if (innerDegrade === 3) {
      this._degrade(backupURL);
    }
  }

  /**
   * @param {string} url  降级到的地址
   * @param {boolean} useMse 是否是降级到mse,true的话软解内部处理不用给video设置src
   */
  _degrade (url, useMse) {
    const {player} = this;
    let mVideo = player.video;
    if (mVideo && mVideo.TAG === 'MVideo') {
      let newVideo = player.video.degradeVideo;
      this.destroy();
      player.video = newVideo;
      mVideo.degrade(url, useMse);
      if (url) {
        player.config.url = url;
      }
      // 替换下dom元素
      let firstChild = player.root.firstChild;
      if (firstChild.TAG === 'MVideo') {
        player.root.replaceChild(newVideo, firstChild)
      }
      const mobilePluginName = FlvPlayer.pluginName.toLowerCase();
      player.plugins[mobilePluginName] = null;
    }
  }

  _toUseMse (url) {
    const { player } = this;
    const { backupConstructor } = player.config;
    if (!backupConstructor || !url) {
      throw new Error(`need backupConstructor and backupURL`);
    }
    if (backupConstructor) {
      player.config.url = url;
      let flvMsePlayer = player.registerPlugin(backupConstructor)
      flvMsePlayer.beforePlayerInit();
      Promise.resolve().then(() => {
        player.video.src = player.url;
        const mobilePluginName = FlvPlayer.pluginName.toLowerCase();
        player.plugins[mobilePluginName] = null;
      })
    }
  }

  // 外部强制降级
  forceDegradeToVideo (url) {
    let isHls = /\.m3u8?/.test(url);
    if (isHls) {
      this._degrade(url);
      return;
    }
    this._degrade(null, true);
    this._toUseMse(url);
  }

  offEvents () {
    this.off(Events.PLAY, this.play);
    this.off(Events.PAUSE, this.pause);
    this.off(Events.CANPLAY, this.canplay);
    this.off(Events.URL_CHANGE, this.switchURL);
    this.off(Events.PROGRESS, this.progress);
    this.off(Events.DEFINITION_CHANGE, this.handleDefinitionChange);
    this.player.video.removeEventListener('lowdecode', this.lowdecode)
  }

  initFlv () {
    const { player } = this;
    const flv = this.context.registry('FLV_CONTROLLER', FLV)(player, this.options)
    this.initFlvEvents(flv)
    this.flv = flv
  }

  canplay () {
    if (!this.player.video) return;
    if (this.player.config.autoplay) return;
    if (this.player.video.buffered.length) {
      this.played = true;
    }
  }

  play () {
    const { player } = this;
    if (this.played) {
      this._destroy()
      player.hasStart = false;
      player.start()
    } else {
      this.addLiveFlag();
    }
    this.played = true
  }

  pause () {
    if (this.flv) {
      this.flv.pause()
    }
  }

  loadData (time = this.player.currentTime) {
    if (this.flv) {
      this.flv.seek(time)
    }
  }

  switchURL (url) {
    this._destroy()
    const {player} = this;
    player.config.url = url;
    player.hasStart = false;
    player.start()
  }

  handleDefinitionChange (change) {
    const { to } = change;
    this.switchURL(to);
  }

  progress () {
    if (!this.player || !this.player.video) return;
    const {buffered, currentTime, config} = this.player;
    let bufferEnd = buffered.end(0);
    let waterLevel = bufferEnd - currentTime;
    let preloadTime = config.preloadTime;
    if (waterLevel > preloadTime * 2) {
      if (bufferEnd - preloadTime > currentTime) {
        this.player.video.currentTime = bufferEnd - preloadTime;
      }
    }
  }

  destroy () {
    this._destroy()
  }

  addLiveFlag () {
    const { player } = this;
    BasePlugin.Util.addClass(player.root, 'xgplayer-is-live')
  }

  _destroy () {
    if (!this.context) return;
    this.offEvents();
    this.context.destroy()
    this.flv = null
    this.context = null
  }
}

export default FlvPlayer
