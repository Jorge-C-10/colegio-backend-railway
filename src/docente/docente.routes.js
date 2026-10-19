import { Router } from 'express';
import * as docente from './docente.controller.js';

const router = Router();

// Ruta para CREAR un dcoente
router.post('/', docente.createDocenteCompleto);

// Ruta para OBTENER todos los docentes
router.get('/', docente.getDocentes);


// Ruta para OBTENER un docentes por ID
router.get('/:id', docente.getDocenteById);


// Ruta para ACTUALIZAR un docente
router.put('/:id', docente.updateDisponibilidad);

// Ruta para ELIMINAR un docente
router.delete('/:id', docente.deleteDocente);


export default router;