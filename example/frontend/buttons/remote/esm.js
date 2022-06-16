import * as freerange from '../../../../src/frontend/src/index'
import * as print from '../utils/print'

const remoteESMTest = async (paths) => {

    console.log('------------------ system (remote esm) ------------------')
    const esmRemote = new freerange.System(paths.remote.esm)
    await esmRemote.init()
    await print.system(esmRemote)
    esmRemote.save()
    
}

export default remoteESMTest