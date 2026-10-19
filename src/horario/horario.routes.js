import { Router } from 'express';
import {
    generarHorario,
    getHorario,
    deleteHorario
} from './horario.controller.js';

const router = Router();

router.post('/generar', generarHorario);
router.get('/:configuracion_jornada_id', getHorario);
router.delete('/:configuracion_jornada_id', deleteHorario);

export default router;