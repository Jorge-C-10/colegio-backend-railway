import pool from '../db.js';

// CREAR CURSO Y ASIGNARLO A UN SALÓN

export const createCurso = async (req, res, next) => {

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const {
            nombre,
            horas_semanales,
            docente_id,
            configuracion_jornada_id,
            color = '#3B82F6',
            estado
        } = req.body;


        // ✅ CORREGIDO: Sin coma después de configuracion_jornada_id
        if (!nombre || !horas_semanales || !docente_id || !configuracion_jornada_id) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Los campos nombre, horas_semanales, docente_id y configuracion_jornada_id son obligatorios.'
            });
        }

        // 2. Verificar que el docente exista
        const [docenteExists] = await connection.query(
            'SELECT id, nombres_completos, especialidad FROM docente WHERE id = ?',
            [docente_id]
        );
        if (docenteExists.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Docente no encontrado o inactivo.'
            });
        }

        // 3. Verificar que la configuración de jornada exista
        const [jornadaExists] = await connection.query(
            'SELECT id, datos_salon_id FROM configuracion_jornada WHERE id = ? AND estado = "activo"',
            [configuracion_jornada_id]
        );
        if (jornadaExists.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Configuración de jornada no encontrada.'
            });
        }

        // 4. Buscar si el curso ya existe por nombre
        let cursoId;
        const [cursoExiste] = await connection.query(
            "SELECT id FROM curso WHERE LOWER(nombre) = LOWER(?) AND estado = 'activo'",
            [nombre.trim()]
        );

        if (cursoExiste.length > 0) {
            cursoId = cursoExiste[0].id;
        } else {
            // Crear nuevo curso con estado 'activo'
            const [resultCurso] = await connection.query(
                `INSERT INTO curso (nombre, color, estado) VALUES (?, ?, 'activo')`,
                [nombre.trim(), color]
            );
            cursoId = resultCurso.insertId;
        }

        // 5. Verificar si ya está asignado
        const [yaAsignado] = await connection.query(
            'SELECT id FROM curso_docente_salon WHERE docente_id = ? AND curso_id = ? AND configuracion_jornada_id = ? AND estado = "activo"',
            [docente_id, cursoId, configuracion_jornada_id]
        );
        if (yaAsignado.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'El docente ya tiene asignado este curso en esta jornada.'
            });
        }

        // 6. Validar horas del docente
        const [maxHoras] = await connection.query(
            'SELECT COALESCE(SUM(horas), 0) AS total_horas FROM disponibilidad_docente WHERE docente_id = ?',
            [docente_id]
        );
        const maxHorasSemana = maxHoras[0].total_horas;

        const [horasAsignadas] = await connection.query(
            'SELECT COALESCE(SUM(horas_semanales), 0) AS total FROM curso_docente_salon WHERE docente_id = ? AND estado = "activo"',
            [docente_id]
        );
        const totalHorasOcupadas = horasAsignadas[0].total;

        if ((totalHorasOcupadas + horas_semanales) > maxHorasSemana) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: `El docente excedería su límite de ${maxHorasSemana} horas.`,
                data: {
                    max_horas_semana: maxHorasSemana,
                    horas_actualmente_ocupadas: totalHorasOcupadas,
                    horas_a_asignar: horas_semanales
                }
            });
        }

        // 7. Insertar asignación con estado 'activo'
        const [resultAsignacion] = await connection.query(
            `INSERT INTO curso_docente_salon 
             (curso_id, docente_id, configuracion_jornada_id, horas_semanales, color, estado)
             VALUES (?, ?, ?, ?, ?, 'activo')`,
            [cursoId, docente_id, configuracion_jornada_id, horas_semanales, color]
        );

        await connection.commit();

        res.status(201).json({
            status: 'success',
            message: `Curso "${nombre}" asignado exitosamente.`,
            data: {
                id: resultAsignacion.insertId,
                curso_id: cursoId,
                nombre: nombre.trim(),
                horas_semanales,
                docente: {
                    id: docente_id,
                    nombre: docenteExists[0].nombres_completos,
                    especialidad: docenteExists[0].especialidad
                },
                color,
                estado: 'activo'
            }
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// =============================================
// LISTAR CURSOS ASIGNADOS (solo curso y docente)
// GET /api/curso/salon/:configuracion_jornada_id
// =============================================
export const getCursosBySalon = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { configuracion_jornada_id } = req.params;

        const [cursos] = await connection.query(
            `SELECT 
                c.nombre AS curso,
                d.nombres_completos AS docente
             FROM curso_docente_salon cds
             INNER JOIN curso c ON cds.curso_id = c.id
             INNER JOIN docente d ON cds.docente_id = d.id
             WHERE cds.configuracion_jornada_id = ? AND cds.estado = 'activo'
             ORDER BY c.nombre`,
            [configuracion_jornada_id]
        );

        res.status(200).json({
            status: 'success',
            data: cursos
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// ACTUALIZAR CURSO ASIGNADO

export const updateCurso = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const { nombre, horas_semanales, docente_id, color, estado } = req.body;

        // 1. Verificar que la asignación exista
        const [exists] = await connection.query(
            'SELECT * FROM curso_docente_salon WHERE id = ?',
            [id]
        );
        if (exists.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Asignación de curso no encontrada.'
            });
        }

        const asignacionActual = exists[0];

        // 2. Si cambia el docente, validar sus horas (SIN validar estado en docente)
        if (docente_id && docente_id !== asignacionActual.docente_id) {
            // Verificar que el nuevo docente exista
            const [docenteExists] = await connection.query(
                'SELECT id FROM docente WHERE id = ?',
                [docente_id]
            );
            if (docenteExists.length === 0) {
                return res.status(404).json({
                    status: 'error',
                    message: 'El nuevo docente no existe.'
                });
            }

            // Obtener horas máximas del nuevo docente
            const [maxHoras] = await connection.query(
                'SELECT COALESCE(SUM(horas), 0) AS total_horas FROM disponibilidad_docente WHERE docente_id = ?',
                [docente_id]
            );
            const maxHorasSemana = maxHoras[0].total_horas;

            // Obtener horas ya asignadas al nuevo docente (excluyendo este registro que se está actualizando)
            const [horasAsignadas] = await connection.query(
                'SELECT COALESCE(SUM(horas_semanales), 0) AS total FROM curso_docente_salon WHERE docente_id = ? AND estado = "activo" AND id != ?',
                [docente_id, id]
            );
            const totalHorasOcupadas = horasAsignadas[0].total;
            const horasACambiar = horas_semanales !== undefined ? horas_semanales : asignacionActual.horas_semanales;

            // Validar que no exceda el límite
            if ((totalHorasOcupadas + horasACambiar) > maxHorasSemana) {
                return res.status(400).json({
                    status: 'error',
                    message: `El docente excedería su límite de ${maxHorasSemana} horas.`,
                    data: {
                        max_horas_semana: maxHorasSemana,
                        horas_actualmente_ocupadas: totalHorasOcupadas,
                        horas_a_asignar: horasACambiar
                    }
                });
            }
        }

        // 3. Actualizar la tabla `curso` (solo si se envían estos campos)
        if (nombre !== undefined || color !== undefined || estado !== undefined) {
            await connection.query(
                `UPDATE curso SET 
                    nombre = COALESCE(?, nombre),
                    color = COALESCE(?, color),
                    estado = COALESCE(?, estado)
                 WHERE id = ?`,
                [
                    nombre ? nombre.trim() : null,
                    color || null,
                    estado || null,
                    asignacionActual.curso_id
                ]
            );
        }

        // 4. Actualizar la tabla `curso_docente_salon`
        await connection.query(
            `UPDATE curso_docente_salon SET 
                docente_id = COALESCE(?, docente_id),
                horas_semanales = COALESCE(?, horas_semanales),
                color = COALESCE(?, color),
                estado = COALESCE(?, estado)
             WHERE id = ?`,
            [
                docente_id || null,
                horas_semanales !== undefined ? horas_semanales : null,
                color || null,
                estado || null,
                id
            ]
        );

        res.status(200).json({
            status: 'success',
            message: 'Curso actualizado exitosamente.'
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// ELIMINAR CURSO ASIGNADO 

export const deleteCurso = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;

        // 1. Verificar que la asignación exista
        const [exists] = await connection.query(
            'SELECT id, curso_id, docente_id, configuracion_jornada_id FROM curso_docente_salon WHERE id = ? AND estado = "activo"',
            [id]
        );
        if (exists.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Asignación de curso no encontrada o ya fue eliminada.'
            });
        }

        // 2. Soft Delete: cambiar estado a 'inactivo'
        await connection.query(
            "UPDATE curso_docente_salon SET estado = 'inactivo' WHERE id = ?",
            [id]
        );

        res.status(200).json({
            status: 'success',
            message: 'Curso eliminado del salón exitosamente.',
            data: {
                id: parseInt(id),
                curso_id: exists[0].curso_id,
                docente_id: exists[0].docente_id
            }
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};