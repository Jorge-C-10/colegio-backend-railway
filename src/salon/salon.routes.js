import { Router } from 'express';
import * as salon from './salon.controller.js';

const router = Router();

// Ruta para CREAR un salon
router.post('/', salon.createDatosSalon);

// Ruta para OBTENER todos los salones
router.get('/', salon.getDatosSalon);

// Ruta para OBTENER un SALON por ID
router.get('/:id', salon.getDatosSalonById);

// Ruta para ACTUALIZAR un salon
router.put('/:id', salon.updateDatosSalon);

// Ruta para ELIMINAR un salon
router.delete('/:id', salon.deleteDatosSalon);

export default router;