import pool from '../db.js'

export const formularioHorario=async(req,res)=>{
try {
    const{}=req.body
    
} catch (error) {
    res.status(500).json({})
}
}