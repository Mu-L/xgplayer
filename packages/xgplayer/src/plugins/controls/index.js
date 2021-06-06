import Plugin, {Events, Util, POSITIONS, Sniffer, STATE_CLASS} from '../../plugin'
// import classNames from 'classnames/bind'

// console.log('ClassName', classNames)
class Controls extends Plugin {
  static get pluginName () {
    return 'controls'
  }

  static get defaultConfig () {
    return {
      disable: false,
      autoHide: true, // 是否自动隐藏
      mode: '', // 显示模式， flex/normal/bottom
      initShow: false // 是否初始化的时候就显示
    }
  }

  beforeCreate (args) {
    if (typeof args.player.config.controls === 'boolean') {
      args.config.disable = !args.player.config.controls
    }
    if (!args.config.mode && Sniffer.device === 'mobile') {
      args.config.mode = 'flex'
    }
    if (args.player.config.marginControls) {
      args.config.autoHide = false
    }
  }

  afterCreate () {
    const {disable, height, mode, autoHide} = this.config
    if (disable) {
      return
    }

    mode === 'flex' && this.player.addClass(STATE_CLASS.FLEX_CONTROLS)
    autoHide && this.player.addClass(STATE_CLASS.AUTOHIDE)
    const style = {
      height: `${height}px`
    }
    Object.keys(style).map(key => {
      this.root.style[key] = style[key]
    })
    this.left = this.find('xg-left-grid')
    this.center = this.find('xg-center-grid')
    this.right = this.find('xg-right-grid')
    this.innerRoot = this.find('xg-inner-controls')

    // 切换为小窗状态的时候进度条同步切换
    this.on(Events.MINI_STATE_CHANGE, (isMini) => {
      isMini ? Util.addClass(this.root, 'mini-controls') : Util.removeClass(this.root, 'mini-controls')
    })
    if (Sniffer.device !== 'mobile') {
      this.bind('mouseenter', this.onMouseEnter)
      this.bind('mouseleave', this.onMouseLeave)
    }
  }

  onMouseEnter = (e) => {
    const { player } = this;
    if (player.userTimer) {
      Util.clearTimeout(player, player.userTimer)
      clearTimeout(player.userTimer)
    }
  }

  onMouseLeave = () => {
    const { player, playerConfig } = this;
    const delay = !playerConfig.closeControlsBlur ? playerConfig.inactive : 200
    player.emit(Events.PLAYER_FOCUS, {delay})
  }

  focus () {
    this.player.emit(Events.PLAYER_FOCUS, {autoHide: false})
  }

  unFocus () {
    this.player.emit(Events.PLAYER_FOCUS, {autoHide: true})
  }

  blur () {
    this.player.emit(Events.PLAYER_BLUR, {ignoreStatus: true})
  }

  recoverAutoHide () {
    this.config.autoHide && Util.addClass(this.root, 'control_autohide')
  }

  pauseAutoHide () {
    Util.removeClass(this.root, 'control_autohide')
  }

  show () {
    Util.addClass(this.root, 'show')
  }

  hide () {
    Util.removeClass(this.root, 'show')
  }

  get mode () {
    return this.config.mode
  }

  registerPlugin (plugin, options = {}, name) {
    if (!this.root) {
      return;
    }
    const defaultConfig = plugin.defaultConfig || {}
    if (!options.root) {
      const position = options.position ? options.position : options.config && options.config.position ? options.config.position : defaultConfig.position
      switch (position) {
        case POSITIONS.CONTROLS_LEFT:
          options.root = this.left
          break
        case POSITIONS.CONTROLS_RIGHT:
          options.root = this.right;
          break;
        case POSITIONS.CONTROLS_CENTER:
          options.root = this.center;
          break;
        case POSITIONS.CONTROLS:
          options.root = this.root;
          break;
        default:
          options.root = this.left
      }
      return super.registerPlugin(plugin, options, name)
    }
  }

  destroy () {
    if (Sniffer.device === 'mobile') {
      this.unbind('mouseenter', this.onMouseEnter)
      this.unbind('mouseleave', this.onMouseLeave)
    }
  }

  render () {
    const { mode, autoHide, initShow, disable } = this.config
    if (disable) {
      return;
    }
   const className =  Util.classNames(
      {'flex-controls': mode === 'flex'},
      {'bottom-controls': mode === 'bottom'},
      {'control_autohide': autoHide},
      {'controls_permanent': !autoHide},
      {'xgplayer-controls-initshow': initShow || !autoHide})
    console.log('className', className)
    return `<xg-controls class="xgplayer-controls ${className}" unselectable="on" onselectstart="return false">
    <xg-inner-controls class="xg-inner-controls xg-pos">
      <xg-left-grid class="xg-left-grid">
      </xg-left-grid>
      <xg-center-grid class="xg-center-grid"></xg-center-grid>
      <xg-right-grid class="xg-right-grid">
      </xg-right-grid>
    </xg-inner-controls>
    </xg-controls>`
  }
}

export default Controls
