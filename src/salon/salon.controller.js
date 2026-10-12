import pool from '../db.js';   // ← ESTA es la ruta correcta

export const createDatosSalon = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const {
            nivel_id,
            grado_id,
            seccion_id,
            periodo_academico_id,
            capacidad = 30,
            estado = 'activo'
        } = req.body;

        // 1. Validar campos obligatorios
        if (!nivel_id || !grado_id || !seccion_id || !periodo_academico_id) {
            return res.status(400).json({
                status: 'error',
                message: 'Los campos nivel_id, grado_id, seccion_id y periodo_academico_id son obligatorios.'
            });
        }

        // 2. Validar estado
        if (estado && !['activo', 'inactivo'].includes(estado)) {
            return res.status(400).json({
                status: 'error',
                message: 'El campo estado solo puede ser "activo" o "inactivo".'
            });
        }

        // 3. Validar capacidad
        if (capacidad < 1 || capacidad > 100) {
            return res.status(400).json({
                status: 'error',
                message: 'La capacidad debe estar entre 1 y 100 alumnos.'
            });
        }

        // 4. Validar que el periodo académico exista
        const [periodoExists] = await connection.query(
            'SELECT id, anio FROM periodo_academico WHERE id = ?',
            [periodo_academico_id]
        );
        if (periodoExists.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'El periodo académico especificado no existe.'
            });
        }

        // 5. Validar que el grado pertenezca al nivel
        const [gradoExists] = await connection.query(
            'SELECT id FROM grado WHERE id = ? AND nivel_id = ?',
            [grado_id, nivel_id]
        );
        if (gradoExists.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'El grado no pertenece al nivel seleccionado.'
            });
        }

        // 6. Validar que la sección pertenezca al grado
        const [seccionExists] = await connection.query(
            'SELECT id FROM seccion WHERE id = ? AND grado_id = ?',
            [seccion_id, grado_id]
        );
        if (seccionExists.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'La sección no pertenece al grado seleccionado.'
            });
        }

        // 7. Obtener el nombre del nivel para generar el código
        const [nivelData] = await connection.query(
            'SELECT nombre FROM nivel WHERE id = ?',
            [nivel_id]
        );
        if (nivelData.length === 0) {
            return res.status(400).json({
                status: 'error',
                message: 'El nivel seleccionado no existe.'
            });
        }

        // 8. Generar el código automáticamente
        const nombreNivel = nivelData[0].nombre.toUpperCase();
        const initials = nombreNivel.substring(0, 3);

        // Buscar el siguiente correlativo para este nivel en este periodo
        const [countResult] = await connection.query(
            'SELECT COUNT(*) as count FROM datos_salon WHERE nivel_id = ? AND periodo_academico_id = ?',
            [nivel_id, periodo_academico_id]
        );

        const nextNumber = countResult[0].count + 1;
        const paddedNumber = String(nextNumber).padStart(3, '0');
        const codigoGenerado = `${initials}-${paddedNumber}`;

        // 9. Verificar duplicado de código
        const [dupCodigo] = await connection.query(
            'SELECT id FROM datos_salon WHERE codigo_salon = ? AND periodo_academico_id = ?',
            [codigoGenerado, periodo_academico_id]
        );
        if (dupCodigo.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: `El código generado ${codigoGenerado} ya existe en este periodo.`
            });
        }

        // 10. Verificar duplicado de combinación (nivel + grado + sección + periodo)
        const [dup] = await connection.query(
            'SELECT id FROM datos_salon WHERE nivel_id = ? AND grado_id = ? AND seccion_id = ? AND periodo_academico_id = ?',
            [nivel_id, grado_id, seccion_id, periodo_academico_id]
        );
        if (dup.length > 0) {
            return res.status(400).json({
                status: 'error',
                message: 'Ya existe un salón con esa combinación de nivel, grado y sección para este periodo académico.'
            });
        }

        // 11. Insertar salón
        const [result] = await connection.query(
            `INSERT INTO datos_salon 
             (codigo_salon, nivel_id, grado_id, seccion_id, periodo_academico_id, capacidad, estado) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [codigoGenerado, nivel_id, grado_id, seccion_id, periodo_academico_id, capacidad, estado]
        );

        res.status(201).json({
            status: 'success',
            message: 'Salón creado exitosamente.',
            data: {
                id: result.insertId,
                codigo_salon: codigoGenerado,
                nivel_id,
                grado_id,
                seccion_id,
                periodo_academico_id,
                capacidad,
                estado
            }
        });
    } catch (error) {
       
       console.log(error) 
       next(error);
    } finally {
        connection.release();
    }
};

// LISTAR TODOS LOS SALONES (con filtros)

export const getDatosSalon = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { nivel_id, grado_id, seccion_id, estado, periodo_academico_id } = req.query;

        let query = `
            SELECT 
                ds.id,
                ds.codigo_salon,
                ds.nivel_id,
                ds.grado_id,
                ds.seccion_id,
                ds.periodo_academico_id,
                ds.capacidad,
                ds.estado,
                n.nombre   AS nivel_nombre,
                g.nombre   AS grado_nombre,
                s.nombre   AS seccion_nombre,
                pa.anio    AS periodo_anio,
                pa.descripcion AS periodo_descripcion,
                CONCAT(g.nombre, ' "', s.nombre, '"') AS nombre_salon
            FROM datos_salon ds
            LEFT JOIN nivel n              ON ds.nivel_id = n.id
            LEFT JOIN grado g              ON ds.grado_id = g.id
            LEFT JOIN seccion s            ON ds.seccion_id = s.id
            LEFT JOIN periodo_academico pa ON ds.periodo_academico_id = pa.id
        `;

        const params = [];
        const conditions = [];

        if (nivel_id) {
            conditions.push('ds.nivel_id = ?');
            params.push(nivel_id);
        }
        if (grado_id) {
            conditions.push('ds.grado_id = ?');
            params.push(grado_id);
        }
        if (seccion_id) {
            conditions.push('ds.seccion_id = ?');
            params.push(seccion_id);
        }
        if (estado) {
            conditions.push('ds.estado = ?');
            params.push(estado);
        }
        if (periodo_academico_id) {
            conditions.push('ds.periodo_academico_id = ?');
            params.push(periodo_academico_id);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY pa.anio DESC, n.orden, g.orden, s.orden';

        const [salones] = await connection.query(query, params);

        res.status(200).json({
            status: 'success',
            count: salones.length,
            data: salones
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// OBTENER SALÓN POR ID

export const getDatosSalonById = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;

        const [salones] = await connection.query(
            `SELECT 
                ds.id,
                ds.codigo_salon,
                ds.nivel_id,
                ds.grado_id,
                ds.seccion_id,
                ds.periodo_academico_id,
                ds.capacidad,
                ds.estado,
                n.nombre AS nivel_nombre,
                g.nombre AS grado_nombre,
                s.nombre AS seccion_nombre,
                pa.anio  AS periodo_anio,
                pa.descripcion AS periodo_descripcion
             FROM datos_salon ds
             LEFT JOIN nivel n              ON ds.nivel_id = n.id
             LEFT JOIN grado g              ON ds.grado_id = g.id
             LEFT JOIN seccion s            ON ds.seccion_id = s.id
             LEFT JOIN periodo_academico pa ON ds.periodo_academico_id = pa.id
             WHERE ds.id = ?`,
            [id]
        );

        if (salones.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'Salón no encontrado.'
            });
        }

        res.status(200).json({
            status: 'success',
            data: salones[0]
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// ACTUALIZAR SALÓN (El código_salon NO se modifica)

export const updateDatosSalon = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;
        const {
            nivel_id,
            grado_id,
            seccion_id,
            periodo_academico_id,
            capacidad,
            estado
        } = req.body;

        // 1. Verificar que el salón exista
        const [exists] = await connection.query(
            'SELECT id, codigo_salon, nivel_id, grado_id, seccion_id, periodo_academico_id, capacidad, estado FROM datos_salon WHERE id = ?',
            [id]
        );

        if (exists.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'El salón no existe.'
            });
        }

        const salonActual = exists[0];
        const codigoOriginal = salonActual.codigo_salon;

        // 2. Validar estado
        if (estado && !['activo', 'inactivo'].includes(estado)) {
            return res.status(400).json({
                status: 'error',
                message: 'El campo estado solo puede ser "activo" o "inactivo".'
            });
        }

        // 3. Validar capacidad
        if (capacidad !== undefined && (capacidad < 1 || capacidad > 100)) {
            return res.status(400).json({
                status: 'error',
                message: 'La capacidad debe estar entre 1 y 100 alumnos.'
            });
        }

        // 4. Validar periodo académico (si se envía)
        if (periodo_academico_id) {
            const [periodoExists] = await connection.query(
                'SELECT id FROM periodo_academico WHERE id = ?',
                [periodo_academico_id]
            );
            if (periodoExists.length === 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'El periodo académico especificado no existe.'
                });
            }
        }

        // 5. Calcular valores finales (nuevos o actuales)
        const targetNivel = nivel_id ?? salonActual.nivel_id;
        const targetGrado = grado_id ?? salonActual.grado_id;
        const targetSeccion = seccion_id ?? salonActual.seccion_id;
        const targetPeriodo = periodo_academico_id ?? salonActual.periodo_academico_id;

        // 6. Validar jerarquía si cambió nivel/grado/sección
        if (nivel_id && grado_id) {
            const [gradoValido] = await connection.query(
                'SELECT id FROM grado WHERE id = ? AND nivel_id = ?',
                [grado_id, nivel_id]
            );
            if (gradoValido.length === 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'El grado no pertenece al nivel seleccionado.'
                });
            }
        }

        if (grado_id && seccion_id) {
            const [seccionValida] = await connection.query(
                'SELECT id FROM seccion WHERE id = ? AND grado_id = ?',
                [seccion_id, grado_id]
            );
            if (seccionValida.length === 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'La sección no pertenece al grado seleccionado.'
                });
            }
        }

        // 7. Verificar duplicado de combinación (excluyendo el propio salón)
        if (nivel_id || grado_id || seccion_id || periodo_academico_id) {
            const [dup] = await connection.query(
                `SELECT id FROM datos_salon 
                 WHERE nivel_id = ? AND grado_id = ? AND seccion_id = ? AND periodo_academico_id = ? AND id != ?`,
                [targetNivel, targetGrado, targetSeccion, targetPeriodo, id]
            );
            if (dup.length > 0) {
                return res.status(400).json({
                    status: 'error',
                    message: 'Ya existe un salón con esa combinación de nivel, grado y sección para este periodo académico.'
                });
            }
        }

        // 8. Actualizar (SIN modificar codigo_salon)
        await connection.query(
            `UPDATE datos_salon SET 
                nivel_id             = COALESCE(?, nivel_id), 
                grado_id             = COALESCE(?, grado_id),
                seccion_id           = COALESCE(?, seccion_id), 
                periodo_academico_id = COALESCE(?, periodo_academico_id),
                capacidad            = COALESCE(?, capacidad),
                estado               = COALESCE(?, estado)
             WHERE id = ?`,
            [
                nivel_id || null,
                grado_id || null,
                seccion_id || null,
                periodo_academico_id || null,
                capacidad || null,
                estado || null,
                id
            ]
        );

        res.status(200).json({
            status: 'success',
            message: 'Salón actualizado exitosamente.',
            data: {
                id: parseInt(id),
                codigo_salon: codigoOriginal,
                nivel_id: targetNivel,
                grado_id: targetGrado,
                seccion_id: targetSeccion,
                periodo_academico_id: targetPeriodo,
                capacidad: capacidad || salonActual.capacidad,
                estado: estado || salonActual.estado
            }
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};

// ELIMINAR SALÓN 

export const deleteDatosSalon = async (req, res, next) => {
    const connection = await pool.getConnection();
    try {
        const { id } = req.params;

        // 1. Verificar que exista
        const [exists] = await connection.query(
            'SELECT id, codigo_salon FROM datos_salon WHERE id = ?',
            [id]
        );
        if (exists.length === 0) {
            return res.status(404).json({
                status: 'error',
                message: 'El salón no existe.'
            });
        }

        const salon = exists[0];

        // 2. Verificar si está en uso por otras tablas
        try {
            const [enUsoConfig] = await connection.query(
                'SELECT id FROM configuracion_jornada WHERE datos_salon_id = ? LIMIT 1',
                [id]
            );
            const [enUsoCursos] = await connection.query(
                'SELECT id FROM curso_docente_salon WHERE configuracion_jornada_id IN (SELECT id FROM configuracion_jornada WHERE datos_salon_id = ?) LIMIT 1',
                [id]
            );

            if (enUsoConfig.length > 0 || enUsoCursos.length > 0) {
                return res.status(400).json({
                    status: 'error',
                    message: `No se puede eliminar el salón ${salon.codigo_salon} porque tiene configuraciones o cursos asignados. Elimínelos primero.`
                });
            }
        } catch (tableError) {
            console.log('⚠️ Tablas de uso aún no creadas, se omite validación.');
        }

        // 3. Eliminar físicamente
        await connection.query('DELETE FROM datos_salon WHERE id = ?', [id]);

        res.status(200).json({
            status: 'success',
            message: `Salón ${salon.codigo_salon} eliminado exitosamente.`
        });
    } catch (error) {
        next(error);
    } finally {
        connection.release();
    }
};