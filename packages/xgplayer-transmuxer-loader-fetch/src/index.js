import EVENTS from 'xgplayer-transmuxer-constant-events';

const LOADER_EVENTS = EVENTS.LOADER_EVENTS;
const READ_STREAM = 0;
const READ_TEXT = 1;
const READ_JSON = 2;
const READ_BUFFER = 3;
class FetchLoader {
  constructor (configs) {
    this.configs = Object.assign({}, configs);
    this.url = null
    this.status = 0
    this.error = null
    this._reader = null;
    this._canceled = false;
    this._destroyed = false;
    this.readtype = this.configs.readtype;
    this.buffer = this.configs.buffer || 'LOADER_BUFFER';
    this._loaderTaskNo = 0;
  }

  init () {
    this.on(LOADER_EVENTS.LADER_START, this.load.bind(this))
  }

  static get type () {
    return 'loader'
  }

  fetch (url, params) {
    let timer = null
    return Promise.race([
      fetch(url, params),
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('fetch timeout'))
        }, 1e4) // 10s
      })
    ]).then((response) => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      return response
    })
  }

  internalLoad (url, params, retryTime) {
    return this.fetch(this.url, params).then((response) => {
      if (response.ok) {
        this.emit(LOADER_EVENTS.LOADER_RESPONSE_HEADERS, this.TAG, response.headers)
        this.status = response.status
        Promise.resolve().then(() => {
          this._onFetchResponse(response);
        })

        return Promise.resolve(response)
      }
      this.loading = false;
      if (retryTime-- > 0) {
        this.internalLoad(url, params, retryTime)
      } else {
        this.emit(LOADER_EVENTS.LOADER_ERROR, this.TAG, new Error(`${response.status} (${response.statusText})`));
      }
    }).catch((error) => {
      this.loading = false;
      if (retryTime-- > 0) {
        this.internalLoad(url, params, retryTime)
      } else {
        this.emit(LOADER_EVENTS.LOADER_ERROR, this.TAG, error);
        throw error;
      }
    })
  }

  load (url, opts) {
    this.url = url;

    this._canceled = false;

    // TODO: Add Ranges
    let params = this.getParams(opts)
    let retryTime = 3
    this.loading = true
    this.internalLoad(url, params, retryTime)
  }

  _onFetchResponse (response) {
    let _this = this;
    let buffer = this._context.getInstance(this.buffer);
    this._loaderTaskNo++;
    let taskno = this._loaderTaskNo;
    if (response.ok === true) {
      switch (this.readtype) {
        case READ_JSON:
          response.json().then((data) => {
            _this.loading = false
            if (!_this._canceled && !_this._destroyed) {
              if (buffer) {
                buffer.push(data);
                _this.emit(LOADER_EVENTS.LOADER_COMPLETE, buffer);
              } else {
                _this.emit(LOADER_EVENTS.LOADER_COMPLETE, data);
              }
            }
          });
          break;
        case READ_TEXT:
          response.text().then((data) => {
            _this.loading = false
            if (!_this._canceled && !_this._destroyed) {
              if (buffer) {
                buffer.push(data);
                _this.emit(LOADER_EVENTS.LOADER_COMPLETE, buffer);
              } else {
                _this.emit(LOADER_EVENTS.LOADER_COMPLETE, data);
              }
            }
          });
          break;
        case READ_BUFFER:
          response.arrayBuffer().then((data) => {
            _this.loading = false
            if (!_this._canceled && !_this._destroyed) {
              if (buffer) {
                buffer.push(new Uint8Array(data));
                _this.emit(LOADER_EVENTS.LOADER_COMPLETE, buffer);
              } else {
                _this.emit(LOADER_EVENTS.LOADER_COMPLETE, data);
              }
            }
          });
          break;
        case READ_STREAM:
        default:
          return this._onReader(response.body.getReader(), taskno);
      }
    }
  }

  _onReader (reader, taskno) {
    let buffer = this._context.getInstance(this.buffer);
    if ((!buffer && this._reader) || this._destroyed) {
      try {
        this._reader.cancel()
      } catch (e) {
        // DO NOTHING
      }
    }

    this._reader = reader
    if (this.loading === false) {
      return
    }

    // reader read function returns a Promise. get data when callback and has value.done when disconnected.
    // read方法返回一个Promise. 回调中可以获取到数据。当value.done存在时，说明链接断开。
    this._reader && this._reader.read().then((val) => {
      if (this._canceled || this._destroyed) {
        if (this._reader) {
          try {
            this._reader.cancel()
          } catch (e) {
            // DO NOTHING
          }
        }
        return;
      }
      if (val.done) {
        this.loading = false
        this.status = 0;
        Promise.resolve().then(() => {
          this.emit(LOADER_EVENTS.LOADER_COMPLETE, buffer)
        })
        return;
      }

      buffer.push(val.value)
      Promise.resolve().then(() => {
        this.emit(LOADER_EVENTS.LOADER_DATALOADED, buffer)
      })
      return this._onReader(reader, taskno)
    }).catch((error) => {
      this.loading = false;
      this.emit(LOADER_EVENTS.LOADER_ERROR, this.TAG, error);
      throw error;
    })
  }

  getParams (opts) {
    let options = Object.assign({}, opts)
    let headers = new Headers()

    let params = {
      method: 'GET',
      headers: headers,
      mode: 'cors',
      cache: 'default'
    }

    // add custmor headers
    // 添加自定义头
    if (typeof this.configs.headers === 'object') {
      let configHeaders = this.configs.headers
      for (let key in configHeaders) {
        if (configHeaders.hasOwnProperty(key)) {
          headers.append(key, configHeaders[key])
        }
      }
    }

    if (typeof options.headers === 'object') {
      let optHeaders = options.headers
      for (let key in optHeaders) {
        if (optHeaders.hasOwnProperty(key)) {
          headers.append(key, optHeaders[key])
        }
      }
    }

    if (options.cors === false) {
      params.mode = 'same-origin'
    }

    // withCredentials is disabled by default
    // withCredentials 在默认情况下不被使用。
    if (options.withCredentials) {
      params.credentials = 'include'
    }

    // TODO: Add ranges;
    return params;
  }

  cancel () {
    if (this._reader) {
      try {
        this._reader.cancel()
      } catch (e) {
        // 防止failed: 200错误被打印到控制台上
      }
      this._reader = null
      this.loading = false
    }
    this._canceled = true;
  }

  destroy () {
    this._destroyed = true
    this.cancel();
  }
}

export default FetchLoader
