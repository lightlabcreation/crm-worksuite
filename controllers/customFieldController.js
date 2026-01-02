const pool = require('../config/db');

const getAll = async (req, res) => {
  try {
    const { module } = req.query;
    
    // Only filter by company_id if explicitly provided in query params or req.companyId exists
    const filterCompanyId = req.query.company_id || req.body.company_id || 1;
    
    let whereClause = 'WHERE is_deleted = 0';
    const params = [];
    
    if (filterCompanyId) {
      whereClause += ' AND company_id = ?';
      params.push(filterCompanyId);
    }
    
    if (module) {
      whereClause += ' AND module = ?';
      params.push(module);
    }

    // Get all custom fields without pagination
    const [fields] = await pool.execute(
      `SELECT * FROM custom_fields ${whereClause} ORDER BY created_at DESC`,
      params
    );

    // Get options, visibility, and enabled_in for each field
    const fieldsWithRelations = await Promise.all(fields.map(async (field) => {
      const [options] = await pool.execute(
        `SELECT option_value FROM custom_field_options WHERE custom_field_id = ? ORDER BY display_order`,
        [field.id]
      );
      const [visibility] = await pool.execute(
        `SELECT visibility FROM custom_field_visibility WHERE custom_field_id = ?`,
        [field.id]
      );
      const [enabledIn] = await pool.execute(
        `SELECT enabled_in FROM custom_field_enabled_in WHERE custom_field_id = ?`,
        [field.id]
      );

      return {
        ...field,
        options: options.map(o => o.option_value),
        visibility: visibility.map(v => v.visibility),
        enabledIn: enabledIn.map(e => e.enabled_in)
      };
    }));

    res.json({ 
      success: true, 
      data: fieldsWithRelations
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch custom fields' });
  }
};

const create = async (req, res) => {
  try {
    // Support both field_name/field_label/field_type and name/label/type formats
    const { 
      company_id, 
      name, 
      label, 
      type, 
      module, 
      required, 
      options, 
      defaultValue, 
      placeholder, 
      helpText, 
      visibility, 
      enabledIn,
      // Frontend format
      field_name,
      field_label,
      field_type,
      default_value,
      help_text,
      enabled_in
    } = req.body;
    
    // Map frontend format to backend format
    const fieldName = name || field_name;
    const fieldLabel = label || field_label;
    const fieldType = type || field_type;
    const fieldModule = module;
    const fieldDefaultValue = defaultValue || default_value;
    const fieldHelpText = helpText || help_text;
    const fieldEnabledIn = enabledIn || enabled_in;
    
    // Validation
    if (!fieldName || !fieldLabel || !fieldType || !fieldModule) {
      return res.status(400).json({
        success: false,
        error: 'name (or field_name), label (or field_label), type (or field_type), and module are required'
      });
    }

    const companyId = company_id || req.companyId;
    if (!companyId) {
      return res.status(400).json({
        success: false,
        error: "company_id is required"
      });
    }

    // Insert custom field
    const [result] = await pool.execute(
      `INSERT INTO custom_fields (
        company_id, name, label, type, module, required, 
        default_value, placeholder, help_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        companyId,
        fieldName,
        fieldLabel,
        fieldType,
        fieldModule,
        required ? 1 : 0,
        fieldDefaultValue || null,
        placeholder || null,
        fieldHelpText || null
      ]
    );

    const fieldId = result.insertId;

    // Insert options if provided (for dropdown/radio/checkbox/multiselect)
    if (options && Array.isArray(options)) {
      for (let i = 0; i < options.length; i++) {
        await pool.execute(
          `INSERT INTO custom_field_options (custom_field_id, option_value, display_order)
           VALUES (?, ?, ?)`,
          [fieldId, options[i], i]
        );
      }
    }

    // Insert visibility settings
    const visibilityList = visibility && Array.isArray(visibility) ? visibility : ['all'];
    for (const vis of visibilityList) {
      await pool.execute(
        `INSERT INTO custom_field_visibility (custom_field_id, visibility)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE visibility = visibility`,
        [fieldId, vis]
      );
    }

    // Insert enabled_in settings
    const enabledInList = fieldEnabledIn && Array.isArray(fieldEnabledIn) ? fieldEnabledIn : ['create', 'edit'];
    for (const enabled of enabledInList) {
      await pool.execute(
        `INSERT INTO custom_field_enabled_in (custom_field_id, enabled_in)
         VALUES (?, ?)
         ON DUPLICATE KEY UPDATE enabled_in = enabled_in`,
        [fieldId, enabled]
      );
    }

    // Get created field with related data
    const [fields] = await pool.execute(
      `SELECT * FROM custom_fields WHERE id = ?`,
      [fieldId]
    );

    const [optionsData] = await pool.execute(
      `SELECT option_value FROM custom_field_options WHERE custom_field_id = ? ORDER BY display_order`,
      [fieldId]
    );

    const [visibilityData] = await pool.execute(
      `SELECT visibility FROM custom_field_visibility WHERE custom_field_id = ?`,
      [fieldId]
    );

    const [enabledInData] = await pool.execute(
      `SELECT enabled_in FROM custom_field_enabled_in WHERE custom_field_id = ?`,
      [fieldId]
    );

    const field = fields[0];
    field.options = optionsData.map(o => o.option_value);
    field.visibility = visibilityData.map(v => v.visibility);
    field.enabledIn = enabledInData.map(e => e.enabled_in);

    res.status(201).json({ 
      success: true, 
      data: field,
      message: 'Custom field created successfully'
    });
  } catch (error) {
    console.error('Create custom field error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create custom field' 
    });
  }
};

module.exports = { getAll, create };

