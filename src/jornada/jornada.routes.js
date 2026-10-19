import { Router } from 'express';
import * as jornada from './jornada.controller.js';

const router = Router();

// Ruta para CREAR un salon
router.post('/', jornada.createJornada);

// Rutas de catálogos (ANTES de /:id)
router.get('/tipos-duracion', jornada.getTiposDuracionBloque);

router.get('/tipos-bloque', jornada.getTiposBloque);

router.get('/dias-semana', jornada.getDiasSemana);

// LISTAR TODAS LAS JORNADAS (admite ?datos_salon_id=)
router.get('/', jornada.getJornadas);

// OBTENER LA JORNADA DE UN SALÓN
router.get('/salon/:salonId', jornada.getJornadaBySalon);

// Ruta para OBTENER un SALON por ID
router.get('/:id', jornada.getJornadaById);


// Ruta para ACTUALIZAR un salon
router.put('/:id', jornada.updateJornada);

// Ruta para ELIMINAR un salon
router.delete('/:id', jornada.deleteJornada);


export default router;