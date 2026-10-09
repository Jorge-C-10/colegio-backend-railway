import {createPool} from 'mysql2/promise'
import {DB_HOST,DB_PASSWORD,DB_NAME,DB_PORT,DB_USER} from './config.js'

const pool=createPool({
    user:DB_USER,
    password:DB_PASSWORD,
    host:DB_HOST,
    port:DB_PORT,
    database:DB_NAME
})

export default pool