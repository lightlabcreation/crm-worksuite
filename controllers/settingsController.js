const pool = require('../config/db');

const get = async (req, res) => {
  try {
    const companyId = req.query.company_id || req.body.company_id || 1;
    const [settings] = await pool.execute(
      `SELECT * FROM system_settings WHERE company_id = ? OR company_id IS NULL`,
      [companyId]
    );
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
};

const update = async (req, res) => {
  try {
    // Handle bulk update (array of settings)
    if (Array.isArray(req.body)) {
      const companyId = req.query.company_id || req.body.company_id || 1;

      const results = [];
      for (const setting of req.body) {
        if (!setting.setting_key) continue;
        
        const setting_value = typeof setting.setting_value === 'object' 
          ? JSON.stringify(setting.setting_value) 
          : setting.setting_value;
        
        await pool.execute(
          `INSERT INTO system_settings (company_id, setting_key, setting_value)
           VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE setting_value = ?`,
          [companyId, setting.setting_key, setting_value, setting_value]
        );
        results.push({ setting_key: setting.setting_key, success: true });
      }

      return res.json({ 
        success: true, 
        message: 'Settings updated successfully',
        data: results
      });
    }

    // Handle single setting update
    let setting_key, setting_value;
    
    // Handle file upload (multipart/form-data)
    if (req.file) {
      setting_key = req.body.setting_key || 'logo';
      setting_value = `/uploads/${req.file.filename}`;
    } else {
      setting_key = req.body.setting_key;
      setting_value = req.body.setting_value;
      
      // Handle object values
      if (typeof setting_value === 'object') {
        setting_value = JSON.stringify(setting_value);
      }
    }
    
    // Validate required fields
    if (!setting_key) {
      return res.status(400).json({ 
        success: false, 
        error: 'setting_key is required' 
      });
    }
    
    const companyId = req.query.company_id || req.body.company_id || 1;
    
    await pool.execute(
      `INSERT INTO system_settings (company_id, setting_key, setting_value)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = ?`,
      [companyId, setting_key, setting_value, setting_value]
    );
    
    res.json({ 
      success: true, 
      message: 'Settings updated',
      data: {
        setting_key,
        setting_value
      }
    });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to update settings',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

/**
 * Get settings by category
 * GET /api/v1/settings/category/:category
 */
const getByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const companyId = req.query.company_id || req.body.company_id || 1;
    
    const [settings] = await pool.execute(
      `SELECT * FROM system_settings 
       WHERE (company_id = ? OR company_id IS NULL)
       AND setting_key LIKE ?`,
      [companyId, `${category}%`]
    );
    
    res.json({ success: true, data: settings });
  } catch (error) {
    console.error('Get settings by category error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch settings' });
  }
};

/**
 * Update multiple settings at once
 * PUT /api/v1/settings/bulk
 */
const bulkUpdate = async (req, res) => {
  try {
    const { settings } = req.body;
    
    if (!Array.isArray(settings)) {
      return res.status(400).json({
        success: false,
        error: 'Settings must be an array'
      });
    }

    const companyId = req.query.company_id || req.body.company_id || 1;

    const results = [];
    for (const setting of settings) {
      if (!setting.setting_key) continue;
      
      const setting_value = typeof setting.setting_value === 'object' 
        ? JSON.stringify(setting.setting_value) 
        : setting.setting_value;
      
      await pool.execute(
        `INSERT INTO system_settings (company_id, setting_key, setting_value)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = ?`,
        [companyId, setting.setting_key, setting_value, setting_value]
      );
      results.push({ setting_key: setting.setting_key, success: true });
    }

    res.json({ 
      success: true, 
      message: 'Settings updated successfully',
      data: results
    });
  } catch (error) {
    console.error('Bulk update settings error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to update settings'
    });
  }
};

module.exports = { 
  get, 
  update, 
  getByCategory, 
  bulkUpdate 
};

