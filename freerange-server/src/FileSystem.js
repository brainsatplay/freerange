import { registry } from 'freerange'
import { stat, createReadStream, readdirSync } from "fs";
import { promisify } from "util";
import mime from "mime-types";

import { pipeline, Readable } from "stream";
const fileInfo = promisify(stat);

export default class FileSystem {
  constructor(options = {}) {
    this.setRoot(options.root)
    this['404'] = options['404'] ?? ''
    this['#cache'] = {}
  }

  setRoot = (str) => {
    if (str) {
      if (str.includes('./') || str.includes('../')) {
        this.root = str
      } else {
        if (str[0] === '/') this.root = `${str}` // Absolute
        else this.root = `./${str}` // Auto-Relative
      }
    } else this.root = './'
  }

  list = (req, res) => {

    try {

      const isDirectory = dirent => dirent.isDirectory()
      const getPaths = source => readdirSync(`${this.root}/${source}`, { withFileTypes: true })

      const drill = (name, o, key) => {
        const arr = getPaths(name)
        arr.forEach(dirent => {
          const str = dirent.name
          if (!o[key]) o[key] = {}
          let target = o[key]
          const path = (name && name != '') ? name + '/' + str : str
          if (isDirectory(dirent)) {
            if (!target[str]) target[str] = {}
            drill(path, target, str)
          } else if (key) {
            target[str] = path
          }

        })
      }

      if (this['#cache'].data == null) drill('', this['#cache'], 'data')

      const string = JSON.stringify(this['#cache'].data)

      res.writeHead(200, {
        "Content-Length": string.length,
        "Content-Type": "application/json"
      });

      const readable = new Readable();
      pipeline(readable, res, (e) => {
        if (e) this.onError(e, 'list()')
      });
      Array.from(string).forEach(c => readable.push(c))
      readable.push(null);
    } catch (e) { this.onError(e, 'list()')}
  }

  onError = (e, prefix) => {
    console.error(`${prefix} Error`, e)
  }

  get = async (req, res) => {

    try {
      const filePath = `${this.root}/${req.params['0']}` // ?? this['404']

      /** Calculate Size of file */
      const { size } = await fileInfo(filePath);
      let contentType = mime.contentType(filePath)
      if (contentType === filePath) {
        const split = filePath.split('.')
        const extension = split[split.length - 1]
        contentType = registry[extension] // Approximation through our API
      }

      const range = req.headers.range;

      const info = { "Content-Length": size }
      if (contentType) info["Content-Type"] = contentType

      /** Check for Range header */

      if (range) {

        /** Extracting Start and End value from Range Header */
        let requests = range.replace(/bytes=/, "").split(',').map(str => str.split("-"))

        const maxRequests = 1 // ONLY ONE
        console.log('Requests', requests)
        if (requests.length > maxRequests) console.warn(`Only getting ${maxRequests} from ${requests.length} sent!`)
        requests = requests.slice(0, maxRequests) // Only some requests

        /** Sending Partial Content With HTTP Code 206 */
        await Promise.all(requests.map(([start, end], i) => {

          return new Promise((resolve, reject) => {

            start = parseInt(start, 10);
            end = end ? parseInt(end, 10) : size - 1;

            if (!isNaN(start) && isNaN(end)) {
              start = start;
              end = size - 1;
            }
            
            if (isNaN(start) && !isNaN(end)) {
              start = size - end;
              end = size - 1;
            }

            // Handle unavailable range request
            if (start >= size || end >= size) {
              res.writeHead(416, { "Content-Range": `bytes */${size}` });  // Return the 416 Range Not Satisfiable.
              return res.end();
            }

            if (requests.length > 1) info["Content-Type"] = 'multipart/byteranges; boundary=3d6b6a416f9b5'
            info["Content-Length"] = (end - start + 1)
            info["Content-Range"] = `bytes ${start}-${end}/${size}`
            info["Accept-Range"] = "bytes"
            res.writeHead(206, info);

            let readable = createReadStream(filePath, { start, end });
            pipeline(readable, res, err => {
              if (err) {
                this.onError(err, 'Range')
                reject(err)
              } else {
                // console.log('Done!', start, end)
                resolve(true)
              }
            });
          })
        }))

      } else {

        res.writeHead(200, info);

        let readable = createReadStream(filePath);

        pipeline(readable, res, err => {
          if (err) this.onError(err)
          // else console.log('Done piping')
        });

      }
    } catch (e) { this.onError(e) }
  }
}