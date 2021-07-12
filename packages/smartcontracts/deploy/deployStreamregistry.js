module.exports = async ({ deployments }) => {
    const { deploy } = deployments

    const minimalForarder = await deploy('MinimalForwarder', {
        from: '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0',
        gasLimit: 4000000
    })
    // console.log(JSON.stringify(minimalForarder))
    await deploy('StreamRegistry', {
        from: '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0',
        gasLimit: 8000000,
        args: ['0x2fb7Cd141026fcF23Abb07593A14D6E45dC33D54', minimalForarder.address]
    })
}
