// utils/APIFeatures.js

class APIFeatures {
  constructor(query, queryString) {
    this.query = query; // Mongoose query (e.g., User.find())
    this.queryString = queryString; // req.query object
  }

  // 1. Filtering (e.g., ?role=user)
  filter() {
    const queryObj = { ...this.queryString };
    const excludedFields = ['page', 'sort', 'limit', 'fields'];
    excludedFields.forEach(el => delete queryObj[el]);

    // Apply basic filtering to the Mongoose query
    this.query = this.query.find(queryObj);
    return this;
  }

  // 2. Sorting (e.g., ?sort=-createdAt)
  sort() {
    if (this.queryString.sort) {
      const sortBy = this.queryString.sort.split(',').join(' ');
      this.query = this.query.sort(sortBy);
    } else {
      // Default sort by creation date
      this.query = this.query.sort('-createdAt'); 
    }
    return this;
  }
  
  // 3. Pagination (e.g., ?page=2&limit=10)
  paginate() {
    const page = this.queryString.page * 1 || 1;
    const limit = this.queryString.limit * 1 || 100; // Default limit 100
    const skip = (page - 1) * limit;

    this.query = this.query.skip(skip).limit(limit);
    return this;
  }
}

module.exports = APIFeatures;