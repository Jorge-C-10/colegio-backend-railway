import express from 'express'
import cors from 'cors';
import morgan from 'morgan';
import {PORT, variablesFaltantes} from './config.js'
import router from './router/index.js'
import pool from './db.js'

const app=express()

app.use(cors());
app.use(morgan('dev'));
app.use(express.json());


app.use('/api', router);

app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ status: 'success', database: 'conectada' });
    } catch (error) {
        res.status(503).json({ status: 'error', database: 'desconectada', code: error.code });
    }
});

app.use((error, req, res, next) => {
    console.error('[API]', error);
    res.status(error.status || 500).json({
        status: 'error',
        message: error.message || 'Error interno del servidor.'
    });
});

const server = app.listen(PORT, () => {
    const faltantes = variablesFaltantes();
    console.log('Corriendo en la terminal', PORT);
    if (faltantes.length > 0) {
        console.warn(`\n[AVISO] Faltan variables de entorno: ${faltantes.join(', ')}`);
        console.warn('Crea un archivo .env en la raíz del backend (ver .env.example).\n');
    }
});

server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`\n[ERROR] El puerto ${PORT} ya está siendo usado por otro proceso.`);
        console.error('Cierra el proceso que lo ocupa o cambia el PORT en tu archivo .env.\n');
        console.error('Para ver quién lo tiene:');
        console.error(`  Get-NetTCPConnection -LocalPort ${PORT} -State Listen | Select-Object OwningProcess`);
        console.error(`  Stop-Process -Id <PID> -Force\n`);
    } else {
        console.error('[ERROR] No se pudo iniciar el servidor:', error.message);
    }
    process.exit(1);
});
