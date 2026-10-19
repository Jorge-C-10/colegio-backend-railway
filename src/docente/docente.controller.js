import pool from '../db.js';

// =============================================
// CREAR DOCENTE COMPLETO
// (Docente + Disponibilidad + Curso de especialidad)
// POST /api/docente/completo
// =============================================
export const createDocenteCompleto = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const {
            nombres_completos,
            especialidad,
            disponibilidad,       // [{dia_semana_id: 1, horas: 2}, ...]
            max_horas_semana      // Límite máximo
        } = req.body;

        // ========================================
        // 1. VALIDACIONES BÁSICAS
        // ========================================
        if (!nombres_completos || !especialidad) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Los campos nombres_completos y especialidad son obligatorios.'
            });
        }

        if (!Array.isArray(disponibilidad) || disponibilidad.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Debe seleccionar al menos un día de disponibilidad.'
            });
        }

        if (!max_horas_semana || max_horas_semana < 1) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Debe ingresar un límite de horas por semana.'
            });
        }

        // ========================================
        // 2. VALIDAR QUE NO EXISTA EL DOCENTE
        // ========================================
        const [docenteExiste] = await connection.query(
            'SELECT id FROM docente WHERE LOWER(nombres_completos) = LOWER(?)',
            [nombres_completos.trim()]
        );
        if (docenteExiste.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Ya existe un docente con ese nombre.'
            });
        }

        // ========================================
        // 3. VALIDAR DISPONIBILIDAD (días y horas)
        // ========================================
        const diasIds = disponibilidad.map(d => d.dia_semana_id);
        const [diasValidos] = await connection.query(
            `SELECT id FROM dias_semana WHERE id IN (${diasIds.map(() => '?').join(',')})`,
            diasIds
        );
        if (diasValidos.length !== diasIds.length) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Uno o más días de la semana no son válidos.'
            });
        }

        // Validar horas por día (0 a 12)
        for (const disp of disponibilidad) {
            if (disp.horas < 0 || disp.horas > 12) {
                await connection.rollback();
                return res.status(400).json({
                    status: 'error',
                    message: `Las horas del día deben estar entre 0 y 12.`
                });
            }
        }

        // ========================================
        // 4. CALCULAR TOTAL DE HORAS ASIGNADAS
        // ========================================
        const totalHorasAsignadas = disponibilidad.reduce((sum, d) => sum + d.horas, 0);

        // ========================================
        // 5. VALIDACIÓN CLAVE: Límite vs Total
        // ========================================
        if (max_horas_semana < totalHorasAsignadas) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: `El límite de ${max_horas_semana} horas es menor al total asignado (${totalHorasAsignadas} horas). El docente necesita al menos ${totalHorasAsignadas} horas disponibles.`,
                data: {
                    total_horas_asignadas: totalHorasAsignadas,
                    max_horas_ingresadas: max_horas_semana
                }
            });
        }

        // ========================================
        // 6. INSERTAR DOCENTE
        // ========================================
        const [resultDocente] = await connection.query(
            `INSERT INTO docente (nombres_completos, especialidad) 
     VALUES (?, ?)`,
            [nombres_completos.trim(), especialidad.trim()]
        );
        const docenteId = resultDocente.insertId;

        // ========================================
        // 7. INSERTAR DISPONIBILIDAD
        // ========================================
        const valoresDisponibilidad = disponibilidad
            .filter(d => d.horas > 0)  // Solo días con horas > 0
            .map(d => [docenteId, d.dia_semana_id, d.horas]);

        if (valoresDisponibilidad.length > 0) {
            await connection.query(
                'INSERT INTO disponibilidad_docente (docente_id, dia_semana_id, horas) VALUES ?',
                [valoresDisponibilidad]
            );
        }

        // ========================================
        // 8. BUSCAR O CREAR EL CURSO DE ESA ESPECIALIDAD
        // ========================================
        const [cursoExiste] = await connection.query(
            "SELECT id FROM curso WHERE LOWER(nombre) = LOWER(?) AND estado = 'activo'",
            [especialidad.trim()]
        );

        let cursoId;
        if (cursoExiste.length > 0) {
            // El curso ya existe, usamos ese
            cursoId = cursoExiste[0].id;
        } else {
            // Crear nuevo curso con esa especialidad
            const [resultCurso] = await connection.query(
                `INSERT INTO curso (nombre, color, estado) 
                 VALUES (?, '#3B82F6', 'activo')`,
                [especialidad.trim()]
            );
            cursoId = resultCurso.insertId;
        }

        await connection.commit();

        // ========================================
        // 9. RESPUESTA EXITOSA
        // ========================================
        res.status(201).json({
            status: 'success',
            message: 'Docente creado exitosamente con disponibilidad y curso asignado.',
            data: {
                docente: {
                    id: docenteId,
                    nombres_completos: nombres_completos.trim(),
                    especialidad: especialidad.trim()
                },
                disponibilidad: {
                    total_horas_asignadas: totalHorasAsignadas,
                    max_horas_semana: max_horas_semana,
                    dias: disponibilidad.filter(d => d.horas > 0)
                },
                curso: {
                    id: cursoId,
                    nombre: especialidad.trim(),
                    accion: cursoExiste.length > 0 ? 'existente' : 'creado'
                }
            }
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};

// LISTAR TODOS LOS DOCENTES (con resumen)

export const getDocentes = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const [docentes] = await connection.query(
            `SELECT 
                d.id,
                d.nombres_completos,
                d.especialidad,
                d.estado,
                COALESCE(SUM(dd.horas), 0) AS total_horas_disponibles
             FROM docente d
             LEFT JOIN disponibilidad_docente dd ON d.id = dd.docente_id
             WHERE d.estado = 'activo'
             GROUP BY d.id
             ORDER BY d.nombres_completos`
        );

        res.status(200).json({
            status: 'success',
            count: docentes.length,
            data: docentes
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// OBTENER DOCENTE POR ID (con disponibilidad y cursos)

export const getDocenteById = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;

        // Datos del docente
        const [docentes] = await connection.query(
            `SELECT 
                d.id,
                d.nombres_completos,
                d.especialidad,
                d.estado,
                COALESCE(SUM(dd.horas), 0) AS total_horas_disponibles
             FROM docente d
             LEFT JOIN disponibilidad_docente dd ON d.id = dd.docente_id
             WHERE d.id = ?
             GROUP BY d.id`,
            [id]
        );

        if (docentes.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Docente no encontrado.'
            });
        }

        const docente = docentes[0];

        // Disponibilidad por día
        const [disponibilidad] = await connection.query(
            `SELECT 
                ds.id AS dia_id,
                ds.nombre,
                ds.abrev,
                ds.orden,
                COALESCE(dd.horas, 0) AS horas
             FROM dias_semana ds
             LEFT JOIN disponibilidad_docente dd 
                ON ds.id = dd.dia_semana_id AND dd.docente_id = ?
             ORDER BY ds.orden`,
            [id]
        );
        docente.disponibilidad = disponibilidad;

        // Cursos asignados (en qué salones enseña)
        const [cursos] = await connection.query(
            `SELECT 
                cds.id,
                cds.curso_id,
                cds.configuracion_jornada_id,
                cds.horas_semanales,
                c.nombre AS curso_nombre,
                ds.codigo_salon,
                CONCAT(g.nombre, ' "', s.nombre, '"') AS salon_nombre
             FROM curso_docente_salon cds
             INNER JOIN curso c ON cds.curso_id = c.id
             INNER JOIN configuracion_jornada cj ON cds.configuracion_jornada_id = cj.id
             INNER JOIN datos_salon ds ON cj.datos_salon_id = ds.id
             INNER JOIN grado g ON ds.grado_id = g.id
             INNER JOIN seccion s ON ds.seccion_id = s.id
             WHERE cds.docente_id = ? AND cds.estado = 'activo'`,
            [id]
        );
        docente.cursos_asignados = cursos;

        res.status(200).json({
            status: 'success',
            data: docente
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};


// ACTUALIZAR DOCENTE

export const updateDocente = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const { nombres_completos, especialidad } = req.body;

        const [exists] = await connection.query(
            'SELECT id FROM docente WHERE id = ?',
            [id]
        );
        if (exists.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Docente no encontrado.'
            });
        }

        // Verificar duplicado
        if (nombres_completos) {
            const [duplicado] = await connection.query(
                'SELECT id FROM docente WHERE LOWER(nombres_completos) = LOWER(?) AND id != ?',
                [nombres_completos.trim(), id]
            );
            if (duplicado.length > 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Ya existe un docente con ese nombre.'
                });
            }
        }

        await connection.query(
            `UPDATE docente SET 
                nombres_completos = COALESCE(?, nombres_completos),
                especialidad = COALESCE(?, especialidad)
             WHERE id = ?`,
            [
                nombres_completos?.trim() || null,
                especialidad?.trim() || null,
                id
            ]
        );

        res.status(200).json({
            status: 'success',
            message: 'Docente actualizado exitosamente.'
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};


// ACTUALIZAR DISPONIBILIDAD (con validación de límite)

export const updateDisponibilidad = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { id } = req.params;
        const { disponibilidad, max_horas_semana } = req.body;

        // 1. Verificar que el docente exista
        const [docenteExists] = await connection.query(
            'SELECT id FROM docente WHERE id = ?',
            [id]
        );
        if (docenteExists.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                status: 'error',
                message: 'Docente no encontrado.'
            });
        }

        // 2. Validar disponibilidad
        if (!Array.isArray(disponibilidad) || disponibilidad.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'La disponibilidad debe ser un array con al menos un día.'
            });
        }

        // 3. Validar días
        const diasIds = disponibilidad.map(d => d.dia_semana_id);
        const [diasValidos] = await connection.query(
            `SELECT id FROM dias_semana WHERE id IN (${diasIds.map(() => '?').join(',')})`,
            diasIds
        );
        if (diasValidos.length !== diasIds.length) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: 'Uno o más días no son válidos.'
            });
        }

        // 4. Calcular total
        const totalHoras = disponibilidad.reduce((sum, d) => sum + d.horas, 0);

        // 5. VALIDACIÓN: Límite vs Total
        if (max_horas_semana && max_horas_semana < totalHoras) {
            await connection.rollback();
            return res.status(400).json({
                status: 'error',
                message: `El límite de ${max_horas_semana} horas es menor al total asignado (${totalHoras} horas).`,
                data: {
                    total_horas_asignadas: totalHoras,
                    max_horas_ingresadas: max_horas_semana
                }
            });
        }

        // 6. Eliminar disponibilidad actual
        await connection.query(
            'DELETE FROM disponibilidad_docente WHERE docente_id = ?',
            [id]
        );

        // 7. Insertar nueva disponibilidad
        const valores = disponibilidad
            .filter(d => d.horas > 0)
            .map(d => [id, d.dia_semana_id, d.horas]);

        if (valores.length > 0) {
            await connection.query(
                'INSERT INTO disponibilidad_docente (docente_id, dia_semana_id, horas) VALUES ?',
                [valores]
            );
        }

        await connection.commit();

        res.status(200).json({
            status: 'success',
            message: 'Disponibilidad actualizada exitosamente.',
            data: {
                docente_id: parseInt(id),
                total_horas_asignadas: totalHoras,
                max_horas_semana: max_horas_semana || null,
                disponibilidad: valores.map(v => ({
                    dia_semana_id: v[1],
                    horas: v[2]
                }))
            }
        });
    } catch (error) {
        await connection.rollback();
        next(error);
    } finally {
        connection.release();
    }
};


// ELIMINAR DOCENTE 

export const deleteDocente = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;

        const [exists] = await connection.query(
            'SELECT id FROM docente WHERE id = ?',
            [id]
        );
        if (exists.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Docente no encontrado.'
            });
        }

        // Verificar si tiene cursos asignados
        const [cursosAsignados] = await connection.query(
            'SELECT id FROM curso_docente_salon WHERE docente_id = ? AND estado = "activo" LIMIT 1',
            [id]
        );
        if (cursosAsignados.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'No se puede eliminar el docente porque tiene cursos asignados a salones.'
            });
        }

        await connection.query(
            "UPDATE docente SET estado = 'inactivo' WHERE id = ?",
            [id]
        );

        res.status(200).json({
            status: 'success',
            message: 'Docente eliminado exitosamente.'
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};