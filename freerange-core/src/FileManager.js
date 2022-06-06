import * as text from './defaults/text.js'
import * as gzip from './defaults/gzip.js'
import * as json from './defaults/json.js'
import * as datauri from './defaults/datauri.js'
import * as native from './native/index.js'
import request from './request.js'

import { get, set } from 'idb-keyval';

import { getInfo } from './index.js'
import RangeFile from './RangeFile.js'

export default class FileManager {
    constructor(options = {}) {
        this.extensions = {}
        this.ignore = options.ignore ?? []
        this.debug = options.debug
        this.directoryCacheName = 'freerangeCache'
        this.directoryName = ''
        this.extend(json)
        this.extend(text)

        // Initialize File System
        this.reset()
    }

    createFileSystemInfo = () => {
        return {
            system: {},
            types: {},
            list: [],
            n: 0
        }
    }

    reset = () => {
        this.files = this.createFileSystemInfo()
    }

    get = async (file, options = {}) => {
        const rangeFile = new RangeFile(file, Object.assign({ manager: this, debug: this.debug }, options))
        await rangeFile.init()
        return rangeFile
    }

    encode = async (o, fileInfo) => {
        const { mimeType, zipped } = getInfo(fileInfo) // Spoof the original file

        let buffer = ''
        if (mimeType && (mimeType.includes('image/') || mimeType.includes('video/'))) content = datauri.encode(o)

        const extension = Object.values(this.extensions).find(o => o.mimeType === mimeType)
        if (extension && extension.encode instanceof Function) buffer = extension.encode(o)
        else {
            console.warn(`No encoder for ${mimeType}. Defaulting to text...`)
            buffer = text.encode(o) // Encode as text by default
        }

        if (zipped) buffer = await gzip.encode(buffer)
        return buffer
    }

    decode = async (o, fileInfo) => {

        const { mimeType, zipped } = getInfo(fileInfo)

        if (zipped) o = await gzip.decode(o, mimeType)
        if (mimeType && (mimeType.includes('image/') || mimeType.includes('video/'))) return o.dataurl

        const extension = Object.values(this.extensions).find(o => o.mimeType === mimeType)
        if (extension && extension.decode instanceof Function) return extension.decode(o)
        else {
            console.warn(`No decoder for ${mimeType}. Defaulting to text...`)
            return text.decode(o) // Decode as text by default
        }
    }

    extend = (ext) => {
        this.extensions[ext.mimeType] = ext
    }

    toLoad = (name) => {
        return this.ignore.reduce((a, b) => a * !name.includes(b), true)
    }

    // --------------- Place Files into the System --------------- 
    loadFile = async (file, path, files = this.files) => {

        const toLoad = this.toLoad(file.name ?? file.path)
        if (toLoad) {

            // Get Path to File
            if (!path) path = file.webkitRelativePath ?? file.relativePath ?? file.path

            if (!(file instanceof RangeFile)) file = await this.get(file, {path, directory: this.directoryName})

            // file system
            let target = files.system
            let split = path.split('/')
            split = split.slice(0, split.length - 1)
            if (path) split.forEach((k, i) => {
                if (!target[k]) target[k] = {}
                target = target[k]
            })

            target[file.name] = file

            // file type
            const extension = file.extension ?? file.name
            if (extension) {
                if (!files.types[extension]) files.types[extension] = []
                files.types[extension].push(file)
            } // e.g. README, CHANGES

            // keep track of file count
            files.n++

            // keep a list of files
            files.list.push(file)
        } else console.warn(`Ignoring ${file.name}`)
    }

    // --------------- Handle Remote File System --------------- 
    request = request

    // --------------- Load Local Files --------------- 
    // https://web.dev/file-system-access/#stored-file-or-directory-handles-and-permissions

    verifyPermission = async (fileHandle, withWrite) => {
        const opts = {};
        if (withWrite) opts.mode = 'readwrite';

        const state = await fileHandle.queryPermission(opts)
        if (await state === 'granted') return true; // Check if we already have permission, if so, return true.

        const requestState = await fileHandle.requestPermission(opts)
        if (requestState === 'granted') return true;  // Request permission to the file, if the user grants permission, return true.

        return false; // The user did not grant permission, return false.
    }

    mountCache = async (progressCallback) => {
        let dirHandle = await get(this.directoryCacheName);
        if (dirHandle) {
            console.log(`Loaded cached mount "${dirHandle.name}" from IndexedDB.`)
            return await this.mount(dirHandle, progressCallback)
        }
        else return // Nothing in the cache
    }

    getSubsystem = async (path) => {

        const files = this.createFileSystemInfo()
        const split = path.split('/')
        const subDir = split.shift()
        path = split.join('/') // Path without directory name
        let target = this.files.system[subDir]
        split.forEach(str => target = target[str])
        let drill = async (target, base) => {
            for (let key in target) {
                const newBase = (base) ? base + '/' + key : key
                const file = target[key]
                if (file instanceof RangeFile) await this.loadFile(file, newBase, files) // TODO: Specify path
                else await drill(file, newBase)
            }
        }

        await drill(target, path)
        return files
    }

    mount = async (fileSystemInfo, progressCallback) => {

        this.reset() // Clear existing file system

        if (!fileSystemInfo) fileSystemInfo = await window.showDirectoryPicker();
        await set(this.directoryCacheName, fileSystemInfo); // Saving file system info (of all types)

        // -------- File System Access API --------
        if (fileSystemInfo instanceof FileSystemDirectoryHandle) {
            await this.createLocalFilesystem(fileSystemInfo, progressCallback)
        }

        // -------- Remote Filesystem --------
        else if (typeof fileSystemInfo === 'string') {

            this.directoryName = fileSystemInfo
            await this.request(fileSystemInfo, { mode: 'cors' }, progressCallback)
                .then(ab => {
                    let datasets = JSON.parse(new TextDecoder().decode(ab))
                    const drill = (o) => {
                        for (let key in o) {
                            const target = o[key]

                            const toLoad = this.toLoad(key)
                            if (toLoad) {
                                if (typeof target === 'string') {
                                    const file = {
                                        origin: this.directoryName,
                                        path: target,
                                        options: {
                                            mode: 'cors' // Always enable CORS
                                        }
                                    }
                                    this.loadFile(file)
                                }
                                else drill(target)
                            }
                        }
                    }

                    drill(datasets)

                }).catch(e => {
                    console.error('File System Load Error', e)
                })
        }

        // -------- File (default) --------
        else await this.loadFile(fileSystemInfo)

        return this.files
    }


    // Iterate Asynchronously Through a Collection
    iterAsync = async (iterable, asyncCallback) => {
        const promises = [];
        for await (const entry of iterable) promises.push(asyncCallback(entry));
        const arr = await Promise.all(promises)
        return arr
    }

    onhandle = async (handle, base = '', progressCallback) => {

        await this.verifyPermission(handle)

        // Skip Directory Name in the Base String
        if (handle.name != this.directoryName) base = (base) ? `${base}/${handle.name}` : handle.name

        const files = []
        if (handle.kind === 'file') {
            const file = await handle.getFile();
            if (progressCallback instanceof Function) files.push({file, base}) // Add file details to an iterable
            else await this.loadFile(file, base) // Load file immediately
        } else if (handle.kind === 'directory') {

            const toLoad = this.toLoad(handle.name)
            if (toLoad) {
                const arr = await this.iterAsync(handle.values(), (entry) => {
                    return this.onhandle(entry, base, progressCallback)
                })
                files.push(...arr.flat())
            }
        }


        // Iterate through Entire File List (of known length) 
        // Note: Only if callback is a function
        if (!base){
            let count = 0
            await this.iterAsync(files, async (o) => {
                await this.loadFile(o.file, o.base)
                count++
                progressCallback(this.directoryName, count / files.length, files.length)
            })
        }

        return files
    }

    createLocalFilesystem = async (handle, progressCallback) => {
        this.directoryName = handle.name
        await this.onhandle(handle, null, progressCallback)
    }

    download = async (progressCallback) => {

        const promises = this.files.list.map(async (rangeFile, index) => {

            const file = rangeFile.file
            const relativePath = file.webkitRelativePath ?? file.relativePath

            const buffer = await rangeFile.export()
            console.log('Downloading', buffer, rangeFile)

            const fileHandle = await native.openFileTree(dirHandle, relativePath)
            if (fileHandle.size == file.size) return // Skip files which are already complete
            const writable = await fileHandle.createWritable()
            const stream = file.stream() // Stream the whole file (???)
            await stream.pipeTo(writable)
            progressCallback(this.directoryName, (index + 1) / this.files.list.length, this.files.list.length)
        })

        await Promise.allSettled(promises)
    }


    // --------------- Unused File Callbacks --------------- 
    dragHandler = async (e) => {
        e.preventDefault();

        const fileHandlesPromises = [...e.dataTransfer.items]
            .filter((item) => item.kind === 'file')
            .map((item) => item.getAsFileSystemHandle());

        for await (const handle of fileHandlesPromises) {
            this.createLocalFilesystem(handle)
        }
    }

    writeFile = async (fileHandle, contents) => {
        const writable = await fileHandle.createWritable();
        await writable.write(contents); // Write contents to stream
        await writable.close();
    }

    delete = async (name, parent) => {
        return await parent.removeEntry(name, { recursive: true });
        // OR await directoryHandle.remove();
    }

    rename = async (name) => {
        return await file.move(name);
    }

    move = async (directory, name) => {
        return await file.move(directory, name)
    }

    getPath = async (file, parent) => {
        return await parent.resolve(file);
    }

    // In an existing directory, create a new directory named "My Documents".
    createDirectory = async (name, parent) => {
        const newDirectoryHandle = await parent.getDirectoryHandle(name, {
            create: true,
        });
        return newDirectoryHandle
    }

    // In this new directory, create a file named "My Notes.txt".
    createFile = async (name, parent) => {
        const newFileHandle = await parent.getFileHandle(name, { create: true });
        return newFileHandle
    }
}