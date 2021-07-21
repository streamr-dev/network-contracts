const key = '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0'
const address = '0xa3d1F77ACfF0060F7213D7BF3c7fEC78df847De1'

module.exports = async ({ deployments }) => {
    const { deploy } = deployments

    const minimalForwarder = await deploy('MinimalForwarder', {
        from: key,
        gasLimit: 4000000
    })
    const streamReg = await deploy('StreamRegistry', {
        from: key,
        gasLimit: 7000000,
        args: ['0x2fb7Cd141026fcF23Abb07593A14D6E45dC33D54', minimalForwarder.address]
    })
    const nodeReg = await deploy('NodeRegistry', {
        from: key,
        gasLimit: 7000000,
        args: [address, false, [], []]
    })
    const ssReg = await deploy('StreamStorageRegistry', {
        from: key,
        gasLimit: 7000000,
        args: [streamReg.address, nodeReg.address, minimalForwarder.address]
    })

    console.log({
        forwarder: minimalForwarder.address,
        streamRegistry: streamReg.address,
        nodeRegistry: nodeReg.address,
        streamStorageRegistry: ssReg.address
    })
}
