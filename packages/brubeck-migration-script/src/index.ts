const mysql = require('mysql')

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'core_test'
})
connection.connect((err: any) => {
    if (err) { throw err }
    console.log('Connected!')
})
