import express from 'express'
import cors from 'cors';
import morgan from 'morgan';
import {PORT} from './config.js'
import router from './router/index.js'

const app=express()

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.use('/api', router);

app.listen(PORT)
console.log('Corriendo en la terminal', PORT)