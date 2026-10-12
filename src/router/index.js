import { Router } from 'express'

//import horarioRoutes from '../horario/horario.routes.js'
import salonRoutes from '../salon/salon.routes.js';
const router = Router()


//router.use('/horario', horarioRoutes)
router.use('/salon', salonRoutes)

export default router