module.exports = async ({ deployments }) => {
    const { deploy } = deployments

    await deploy('ENSCache', {
        from: '0x5e98cce00cff5dea6b454889f359a4ec06b9fa6b88e9d69b86de8e1c81887da0',
        gasLimit: 4000000,
        args: ['0x3AE0ad89b0e094fD09428589849C161f0F7f4E6A', 'asdf']
    })
}
