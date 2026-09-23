from django.contrib import admin
from .models import UserProfile


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'user', 'role', 'plant_name', 'created_at')
    list_filter = ('role',)
    search_fields = ('full_name', 'user__username', 'plant_name')

