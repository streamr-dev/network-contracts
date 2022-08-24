const express = require('express')
const bodyParser = require('body-parser')

const { createRequest } = require('./index')

const app = express()
const port = process.env.EA_PORT || 8080
const { log } = console

app.use(bodyParser.json())

app.post('/', (req, res) => {
    log('POST Data: ', req.body)
    createRequest(req.body, (status, result) => {
        log('Result: ', result)
        res.status(status).json(result)
    })
})

app.get('/health', (req, res) => {
    res.send('healthy')
})

app.listen(port, () => log(`Listening on port ${port}!`))
