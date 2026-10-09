import {Router} from 'express'
import horarioRoutes from '../horario/horario.routes.js'

const router=Router()

router.use('/horario',horarioRoutes)


export default router