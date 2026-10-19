import { Router } from 'express'

import horarioRoutes from '../horario/horario.routes.js'
import salonRoutes from '../salon/salon.routes.js';
import jornadaRoutes from '../jornada/jornada.routes.js';
import docenteRoutes from '../docente/docente.routes.js';
import cursoRoutes from '../curso/curso.routes.js';

const router = Router()


router.use('/horario', horarioRoutes)
router.use('/salon', salonRoutes)
router.use('/jornada', jornadaRoutes);
router.use('/docente', docenteRoutes);
router.use('/curso', cursoRoutes);

export default router