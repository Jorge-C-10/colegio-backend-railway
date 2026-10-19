import { Router } from 'express';
import * as jornada from './jornada.controller.js';

const router = Router();

// Ruta para CREAR un salon
router.post('/', jornada.createJornada);

// Ruta para OBTENER todos los salones
router.get('/', jornada.getJornadaBySalon);

router.get('/tipos-duracion', jornada.getTiposDuracionBloque);

router.get('/tipos-bloque', jornada.getTiposBloque);

// Ruta para OBTENER un SALON por ID
router.get('/:id', jornada.getJornadaById);


// Ruta para ACTUALIZAR un salon
router.put('/:id', jornada.updateJornada);

// Ruta para ELIMINAR un salon
router.delete('/:id', jornada.deleteJornada);


export default router;