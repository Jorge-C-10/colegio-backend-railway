import { Router } from 'express';
import {
    createCurso,
    getCursosBySalon,
    updateCurso,
    deleteCurso

} from './curso.controller.js';

const router = Router();

// Rutas específicas (ANTES de /:id)
router.post('/', createCurso);

router.get('/salon/:configuracion_jornada_id', getCursosBySalon);

// Rutas con parámetros (AL FINAL)
router.get('/:id', (req, res) => {
    res.status(200).json({ status: 'success', message: 'Endpoint para obtener curso por ID' });
});
router.put('/:id', updateCurso);
router.delete('/:id', deleteCurso);

export default router;