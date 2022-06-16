export const get = (path, rel = '') => {

    if (rel[rel.length - 1] === '/') rel = rel.slice(0, -1) // Remove trailing slashes

    let dirTokens = rel.split('/')
    if (dirTokens.length === 1 && dirTokens[0] === '') dirTokens = [] // Remove consequence of empty string rel

    const potentialFile = dirTokens.pop() // remove file name
    if (potentialFile && !potentialFile.includes('.')) dirTokens.push(potentialFile) // ASSUMPTION: All files have an extension

    const extensionTokens = path.split('/').filter(str => {
        if (str === '..') {
            if (dirTokens.length == 0) console.error('Derived path is going out of the valid filesystem!')
            dirTokens.pop() // Pop off directories
            return false
        } else if (str === '.') return false
        else return true
    })

    const newPath = [...dirTokens, ...extensionTokens].join('/')

    return newPath
}