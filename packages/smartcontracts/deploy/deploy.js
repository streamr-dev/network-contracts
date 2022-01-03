const key = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const address = '0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1'

const CHAINLINK_JOBID = 'c99333d032ed4cb8967b956c7f0329b5'
const ORACLE_ADDRESS = '0xD94D41F23F1D42C51Ab61685e5617BBC858e5871'

module.exports = async ({ deployments }) => {
    const { deploy } = deployments

    const minimalForwarder = await deploy('MinimalForwarder', {
        from: key,
        gasLimit: 4000000
    })
    const ensCache = await deploy('ENSCache', {
        from: key,
        gasLimit: 6000000,
        args: [ORACLE_ADDRESS, CHAINLINK_JOBID]
        // args: [ORACLE_ADDRESS, CHAINLINK_JOBID, minimalForwarder.address]
    })
    const streamReg = await deploy('StreamRegistry', {
        from: key,
        gasLimit: 6000000,
        args: [ensCache.address, minimalForwarder.address]
    })
    const nodeReg = await deploy('NodeRegistry', {
        from: key,
        gasLimit: 6000000,
        args: [address, false, [], []]
    })
    const ssReg = await deploy('StreamStorageRegistry', {
        from: key,
        gasLimit: 6000000,
        args: [streamReg.address, nodeReg.address, minimalForwarder.address]
    })

    console.log({
        forwarder: minimalForwarder.address,
        ensCache: ensCache.address,
        streamRegistry: streamReg.address,
        nodeRegistry: nodeReg.address,
        streamStorageRegistry: ssReg.address
    })
}
